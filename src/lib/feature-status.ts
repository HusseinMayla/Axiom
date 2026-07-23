import type { SupabaseClient } from "@supabase/supabase-js";

/** Records that the planner found an active feature already satisfied. */
export async function markFeatureCompletedWithoutTask({
  supabase,
  projectId,
  featureId,
  contextNodeId,
  reason,
}: {
  supabase: SupabaseClient;
  projectId: string;
  featureId: string;
  contextNodeId: string | null;
  reason: string;
}) {
  const now = new Date().toISOString();
  const { error: featureError } = await supabase
    .from("features")
    .update({ status: "completed", updated_at: now })
    .eq("id", featureId)
    .eq("project_id", projectId);
  if (featureError) throw new Error("Could not mark the feature complete: " + featureError.message);

  if (!contextNodeId) return;
  const { data: node, error: nodeError } = await supabase
    .from("context_nodes")
    .select("content")
    .eq("id", contextNodeId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (nodeError) throw new Error("Could not load feature status: " + nodeError.message);
  if (!node) return;

  const content = (node.content ?? {}) as Record<string, unknown>;
  const currentStatus = (content.current_status ?? {}) as Record<string, unknown>;
  const { error: statusError } = await supabase
    .from("context_nodes")
    .update({
      content: {
        ...content,
        current_status: {
          ...currentStatus,
          implementation_state: "completed",
          summary: "Planner confirmed that no further implementation task is needed. " + reason,
          confirmed_by: "planner_no_work",
          confirmed_at: now,
          active_task: null,
          remaining_work: [],
        },
      },
      updated_at: now,
    })
    .eq("id", contextNodeId);
  if (statusError) throw new Error("Could not record feature completion: " + statusError.message);
}
