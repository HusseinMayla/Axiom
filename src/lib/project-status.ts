import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function updateProjectImplementationState({
  supabase,
  projectId,
  state,
  summary,
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  projectId: string;
  state: "not_started" | "in_progress" | "awaiting_review" | "completed" | "blocked";
  summary: string;
}) {
  const { data: rootNode } = await supabase
    .from("context_nodes")
    .select("id, content")
    .eq("project_id", projectId)
    .eq("kind", "project")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!rootNode) return;
  const content = (rootNode.content ?? {}) as Record<string, unknown>;
  const currentStatus = (content.current_status ?? {}) as Record<string, unknown>;

  await supabase
    .from("context_nodes")
    .update({
      content: {
        ...content,
        current_status: {
          ...currentStatus,
          implementation_state: state,
          summary,
          confirmed_by: "human_action",
          confirmed_at: new Date().toISOString(),
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", rootNode.id);
}
