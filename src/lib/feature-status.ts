import type { SupabaseClient } from "@supabase/supabase-js";

/** Converts an unsupported feature-level no-work result into a human decision. */
export async function requestFeatureClarificationAfterNoWork({
  supabase,
  projectId,
  featureId,
  featureName,
  contextNodeId,
  reason,
}: {
  supabase: SupabaseClient;
  projectId: string;
  featureId: string;
  featureName: string;
  contextNodeId: string | null;
  reason: string;
}) {
  const now = new Date().toISOString();
  const question = "Axiom could not identify the next bounded task for “" + featureName + ".” Is this feature complete, or what specific outcome should be delivered next?";
  const rationale = "The planner returned no task: " + reason;
  const { data: existing, error: existingError } = await supabase
    .from("clarification_questions")
    .select("question, rationale")
    .eq("project_id", projectId)
    .eq("feature_id", featureId)
    .eq("status", "open")
    .maybeSingle();
  if (existingError) throw new Error("Could not inspect feature clarifications: " + existingError.message);

  if (!existing) {
    const { error: questionError } = await supabase.from("clarification_questions").insert({
      project_id: projectId,
      feature_id: featureId,
      question,
      rationale,
    });
    if (questionError) throw new Error("Could not save feature clarification: " + questionError.message);
  }

  if (!contextNodeId) return { question: existing?.question ?? question, rationale: existing?.rationale ?? rationale, created: !existing };
  const { data: node, error: nodeError } = await supabase
    .from("context_nodes")
    .select("content")
    .eq("id", contextNodeId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (nodeError) throw new Error("Could not load feature status: " + nodeError.message);
  if (!node) return { question: existing?.question ?? question, rationale: existing?.rationale ?? rationale, created: !existing };

  const content = (node.content ?? {}) as Record<string, unknown>;
  const currentStatus = (content.current_status ?? {}) as Record<string, unknown>;
  const { error: statusError } = await supabase
    .from("context_nodes")
    .update({
      content: {
        ...content,
        current_status: {
          ...currentStatus,
          implementation_state: "blocked",
          summary: "Planner could not safely identify the next feature task. " + reason,
          confirmed_by: "planner_no_work_requires_human_decision",
          confirmed_at: now,
          active_task: null,
          remaining_work: ["Answer the feature clarification before Axiom plans more work."],
        },
      },
      updated_at: now,
    })
    .eq("id", contextNodeId);
  if (statusError) throw new Error("Could not record feature clarification: " + statusError.message);
  return { question: existing?.question ?? question, rationale: existing?.rationale ?? rationale, created: !existing };
}
