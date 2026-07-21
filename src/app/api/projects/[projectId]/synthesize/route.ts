import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { synthesizeProjectContext } from "@/lib/ai/context-synthesis";
import type { DiscoveryAnswers } from "@/lib/discovery";
import { readRepositoryFiles, type AvailableRepository } from "@/lib/github/app";
import { initialFeatureCurrentStatus, initialProjectCurrentStatus } from "@/lib/current-status";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const rawBody = await request.text();
  let requestBody: unknown = {};
  try {
    requestBody = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return Response.json({ error: "Invalid context feedback request." }, { status: 400 });
  }
  const body = z.object({ feedback: z.string().trim().min(10).max(4000).optional() }).safeParse(requestBody);
  if (!body.success) return Response.json({ error: "Context feedback must be between 10 and 4,000 characters." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Sign in before generating project context." }, { status: 401 });
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, settings, spent_estimate_cents, budget_cap_cents")
    .eq("id", projectId)
    .single();

  if (!project) {
    return Response.json({ error: "Project not found." }, { status: 404 });
  }

  if (project.spent_estimate_cents >= project.budget_cap_cents) {
    return Response.json({ error: "This project has reached its AI budget cap." }, { status: 409 });
  }

  const { data: discovery } = await supabase
    .from("project_discovery")
    .select("answers, stage")
    .eq("project_id", projectId)
    .single();

  const { data: repositoryMap } = await supabase
    .from("context_nodes")
    .select("content")
    .eq("project_id", projectId)
    .eq("kind", "repository_map")
    .eq("source", "scanner")
    .in("status", ["draft", "approved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!discovery || (discovery.stage === "draft" && !repositoryMap)) {
    return Response.json({ error: "Connect and scan a repository, or submit the client-discovery brief, before generating context." }, { status: 409 });
  }

  const { data: questions } = await supabase
    .from("clarification_questions")
    .select("id, question, answer, status")
    .eq("project_id", projectId)
    .order("created_at");

  if (questions?.some((question) => question.status === "open")) {
    return Response.json({ error: "Answer the open clarification questions before generating context again." }, { status: 409 });
  }

  try {
    const result = await synthesizeProjectContext({
      projectName: project.name,
      discoveryAnswers: (discovery.answers ?? {}) as DiscoveryAnswers,
      answeredClarifications: (questions ?? [])
        .filter((question) => question.status === "answered" && question.answer)
        .map((question) => ({ question: question.question, answer: question.answer as string })),
      humanFeedback: body.data.feedback,
      model: engineerModelFromSettings(project.settings),
      repositoryEvidence: repositoryMap ? repositoryEvidenceFromContent(repositoryMap.content) : undefined,
      loadAdditionalFiles: repositoryMap
        ? async (paths) => {
          const repository = repositoryFromProjectSettings(project.settings);
          return repository ? readRepositoryFiles(repository, paths) : [];
        }
        : undefined,
    });

    if (result.type === "clarifications") {
      await supabase.from("clarification_questions").delete().eq("project_id", projectId).eq("status", "open");

      const { error: questionsError } = await supabase
        .from("clarification_questions")
        .insert(result.questions.map((question) => ({
          project_id: projectId,
          question: question.question,
          rationale: question.rationale,
        })));

      if (questionsError) {
        return Response.json({ error: questionsError.message }, { status: 500 });
      }

      await supabase
        .from("project_discovery")
        .update({ stage: "clarifying", updated_at: new Date().toISOString() })
        .eq("project_id", projectId);

      return Response.json({ type: "clarifications", count: result.questions.length });
    }

    await supabase.from("features").delete().eq("project_id", projectId).eq("status", "draft");
    await supabase.from("context_nodes").delete().eq("project_id", projectId).eq("kind", "project").eq("status", "draft");
    const projectCurrentStatus = initialProjectCurrentStatus(repositoryHasNoSourceFiles(repositoryMap?.content));

    const { data: rootNode, error: rootError } = await supabase
      .from("context_nodes")
      .insert({
        project_id: projectId,
        kind: "project",
        status: "draft",
        source: "ai_summary",
        title: "Project context draft",
        content: {
          project_summary: result.draft.project_summary,
          goals: result.draft.goals,
          technical_constraints: result.draft.technical_constraints,
          operating_rules: result.draft.operating_rules,
          future_plans: result.draft.future_plans,
          features: result.draft.features,
          current_status: projectCurrentStatus,
        },
      })
      .select("id")
      .single();

    if (rootError || !rootNode) {
      return Response.json({ error: rootError?.message ?? "Could not save the project context draft." }, { status: 500 });
    }

    for (const feature of result.draft.features) {
      const { data: featureNode, error: featureNodeError } = await supabase
        .from("context_nodes")
        .insert({
          project_id: projectId,
          parent_id: rootNode.id,
          kind: "feature",
          status: "draft",
          source: "ai_summary",
          title: feature.name,
          content: {
            description: feature.description,
            use_cases: feature.use_cases,
            current_status: initialFeatureCurrentStatus(),
          },
        })
        .select("id")
        .single();

      if (featureNodeError || !featureNode) {
        return Response.json({ error: featureNodeError?.message ?? "Could not save a feature context draft." }, { status: 500 });
      }

      const { error: featureError } = await supabase.from("features").insert({
        project_id: projectId,
        context_node_id: featureNode.id,
        name: feature.name,
        description: feature.description,
        priority: feature.priority,
        status: "draft",
      });

      if (featureError) {
        return Response.json({ error: featureError.message }, { status: 500 });
      }
    }

    await supabase.from("project_discovery").update({
      stage: "ready_for_review",
      updated_at: new Date().toISOString(),
    }).eq("project_id", projectId);

    await supabase.from("projects").update({ state: "context_draft" }).eq("id", projectId);

    if (body.data.feedback) {
      await supabase.from("events").insert({
        project_id: projectId,
        actor_type: "human",
        event_type: "context_feedback",
        payload: { feedback: body.data.feedback },
      });
    }

    if (repositoryMap) {
      const map = (repositoryMap.content ?? {}) as Record<string, unknown>;

      await supabase.from("context_nodes").update({
        content: { ...map, inspected_files: result.ingestedFiles },
        updated_at: new Date().toISOString(),
      }).eq("project_id", projectId).eq("kind", "repository_map").eq("source", "scanner").eq("status", "draft");
    }

    return Response.json({ type: "context", ingestedFileCount: result.ingestedFiles.length, additionallyIngestedFileCount: result.additionallyIngestedFiles.length });
  } catch (error) {
    console.error("Axiom context synthesis failed", error);
    if (isRateLimitError(error)) {
      return Response.json({ error: "Gemini rate limit reached. Wait a minute, or switch GEMINI_MODEL_SMART to the flash-lite model while testing." }, { status: 429 });
    }

    return Response.json({ error: "Gemini could not produce a valid context draft. Try again or refine the brief." }, { status: 502 });
  }
}

function engineerModelFromSettings(settings: unknown) {
  const model = (settings as { engineer?: { model?: unknown } } | null)?.engineer?.model;
  return model === "gemini-3.1-flash-lite" || model === "gemini-3.5-flash" ? model : undefined;
}

function repositoryFromProjectSettings(settings: unknown): AvailableRepository | null {
  const github = (settings as { github?: unknown } | null)?.github as Record<string, unknown> | undefined;
  if (!github
    || typeof github.repository_id !== "number"
    || typeof github.installation_id !== "number"
    || typeof github.owner !== "string"
    || typeof github.name !== "string"
    || typeof github.full_name !== "string"
    || typeof github.default_branch !== "string"
    || typeof github.private !== "boolean") {
    return null;
  }

  return {
    id: github.repository_id,
    installationId: github.installation_id,
    owner: github.owner,
    name: github.name,
    fullName: github.full_name,
    defaultBranch: github.default_branch,
    private: github.private,
    htmlUrl: "",
  };
}

function isRateLimitError(error: unknown) {
  const candidate = error as { status?: unknown; statusCode?: unknown; error?: { code?: unknown } };
  return candidate.status === 429
    || candidate.statusCode === 429
    || candidate.error?.code === "too_many_requests";
}

function repositoryEvidenceFromContent(content: unknown) {
  const map = (content ?? {}) as Record<string, unknown>;
  const repository = (map.repository ?? {}) as Record<string, unknown>;
  const tree = Array.isArray(map.tree) ? map.tree.filter((path): path is string => typeof path === "string") : [];
  const fileSizes = Object.fromEntries(Object.entries((map.file_sizes ?? {}) as Record<string, unknown>)
    .flatMap(([path, size]) => typeof size === "number" ? [[path, size] as const] : []));
  const inspectedFiles = Array.isArray(map.inspected_files)
    ? map.inspected_files.flatMap((file) => {
      const item = file as Record<string, unknown>;
      return typeof item.path === "string" && typeof item.content === "string"
        ? [{ path: item.path, content: item.content }]
        : [];
    })
    : [];

  return {
    fullName: typeof repository.full_name === "string" ? repository.full_name : "Connected repository",
    defaultBranch: typeof repository.default_branch === "string" ? repository.default_branch : "main",
    sourceFileCount: typeof repository.source_file_count === "number" ? repository.source_file_count : 0,
    languageHints: Array.isArray(repository.language_hints)
      ? repository.language_hints.filter((language): language is string => typeof language === "string")
      : [],
    scanTruncated: repository.scan_truncated === true,
    tree,
    fileSizes,
    inspectedFiles,
  };
}

function repositoryHasNoSourceFiles(repositoryMapContent: unknown) {
  const map = (repositoryMapContent ?? {}) as Record<string, unknown>;
  const repository = (map.repository ?? {}) as Record<string, unknown>;
  const sourceFileCount = typeof repository.source_file_count === "number" ? repository.source_file_count : null;
  return sourceFileCount === 0;
}
