import { NextRequest } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runAutomationCycle } from "@/lib/automation-cycle";

const answersSchema = z.object({
  answers: z.array(z.object({
    id: z.string().uuid(),
    answer: z.string().trim().min(1).max(10000),
  })).min(1).max(50),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const parsed = answersSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json({ error: "Write a response for each question before saving." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Sign in before answering clarification questions." }, { status: 401 });
  }

  for (const answer of parsed.data.answers) {
    if (!answer.answer.trim()) continue;
    const { data: q } = await supabase
      .from("clarification_questions")
      .select("feature_id")
      .eq("id", answer.id)
      .eq("project_id", projectId)
      .maybeSingle();

    const { error } = await supabase
      .from("clarification_questions")
      .update({ answer: answer.answer.trim(), status: "answered", answered_at: new Date().toISOString() })
      .eq("id", answer.id)
      .eq("project_id", projectId)
      .eq("status", "open");

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    if (q?.feature_id) {
      const [{ data: remaining }, { data: feature }] = await Promise.all([
        supabase
        .from("clarification_questions")
        .select("id")
        .eq("project_id", projectId)
        .eq("feature_id", q.feature_id)
        .eq("status", "open"),
        supabase.from("features").select("status").eq("id", q.feature_id).eq("project_id", projectId).maybeSingle(),
      ]);
      if (!remaining || remaining.length === 0) {
        await supabase.from("features").update({ status: feature?.status === "in_development" ? "in_development" : "active", updated_at: new Date().toISOString() }).eq("id", q.feature_id);
      }
    }
  }

  await supabase
    .from("project_discovery")
    .update({ stage: "submitted", updated_at: new Date().toISOString() })
    .eq("project_id", projectId);

  after(async () => {
    try {
      const results = await runAutomationCycle({ supabase, projectId, owner: "clarification-answered-" + user.id });
      await supabase.from("events").insert({ project_id: projectId, actor_type: "system", event_type: "automation_woken_by_clarification", payload: { clarification_ids: parsed.data.answers.map((answer) => answer.id), results } });
    } catch (error) {
      await supabase.from("events").insert({ project_id: projectId, actor_type: "system", event_type: "automation_wake_failed", payload: { reason: error instanceof Error ? error.message : "Automation wake-up failed after clarification." } });
    }
  });

  return Response.json({ ok: true });
}

