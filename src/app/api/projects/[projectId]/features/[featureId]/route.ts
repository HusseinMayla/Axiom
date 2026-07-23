import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const updateSchema = z.object({ state: z.enum(["active", "completed"]) });
const ACTIVE_TASK_STATES = ["planned", "waiting_for_approval", "approved", "queued", "running", "pending_review", "waiting_for_human_approval"];

export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string; featureId: string }> }) {
  const { projectId, featureId } = await params;
  const parsed = updateSchema.safeParse(await request.json());
  if (!parsed.success) return Response.json({ error: "Choose whether to resume or complete this feature." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in before changing a feature." }, { status: 401 });

  const { data: feature } = await supabase
    .from("features")
    .select("id, name, context_node_id")
    .eq("id", featureId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!feature) return Response.json({ error: "Feature not found." }, { status: 404 });

  if (parsed.data.state === "completed") {
    const { data: activeTask } = await supabase
      .from("tasks")
      .select("id")
      .eq("project_id", projectId)
      .eq("feature_id", featureId)
      .in("state", ACTIVE_TASK_STATES)
      .is("archived_at", null)
      .maybeSingle();
    if (activeTask) return Response.json({ error: "Resolve the active feature task before marking this feature complete." }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("features")
    .update({ status: parsed.data.state, updated_at: now })
    .eq("id", featureId)
    .eq("project_id", projectId);
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  if (feature.context_node_id) {
    const { data: node } = await supabase.from("context_nodes").select("content").eq("id", feature.context_node_id).maybeSingle();
    if (node) {
      const content = (node.content ?? {}) as Record<string, unknown>;
      const currentStatus = (content.current_status ?? {}) as Record<string, unknown>;
      await supabase.from("context_nodes").update({
        content: {
          ...content,
          current_status: {
            ...currentStatus,
            implementation_state: parsed.data.state === "completed" ? "completed" : "not_started",
            summary: parsed.data.state === "completed" ? "Human marked this feature complete." : "Human reopened this feature for additional development.",
            confirmed_by: "human_feature_decision",
            confirmed_at: now,
            active_task: null,
          },
        },
        updated_at: now,
      }).eq("id", feature.context_node_id);
    }
  }

  const eventType = parsed.data.state === "completed" ? "feature_completed_by_human" : "feature_reopened_by_human";
  await supabase.from("events").insert({ project_id: projectId, actor_type: "human", event_type: eventType, payload: { feature_id: featureId, feature_name: feature.name } });
  return Response.json({ ok: true, state: parsed.data.state });
}
