import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const approvalSchema = z.object({
  activeFeatureIds: z.array(z.string().uuid()).min(1).max(12),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const parsed = approvalSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json({ error: "Select at least one feature to activate." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Sign in before approving context." }, { status: 401 });
  }

  const { data: rootNode } = await supabase
    .from("context_nodes")
    .select("id")
    .eq("project_id", projectId)
    .eq("kind", "project")
    .eq("status", "draft")
    .maybeSingle();

  if (!rootNode) {
    return Response.json({ error: "No draft context is waiting for approval." }, { status: 409 });
  }

  const { data: draftFeatures, error: featuresError } = await supabase
    .from("features")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "draft");

  if (featuresError || !draftFeatures?.length) {
    return Response.json({ error: featuresError?.message ?? "No draft features are available for approval." }, { status: 409 });
  }

  const draftIds = new Set(draftFeatures.map((feature) => feature.id));
  const selectedIds = [...new Set(parsed.data.activeFeatureIds)];

  if (selectedIds.some((id) => !draftIds.has(id))) {
    return Response.json({ error: "A selected feature is not part of this context draft." }, { status: 400 });
  }

  const heldIds = draftFeatures.map((feature) => feature.id).filter((id) => !selectedIds.includes(id));

  const { error: contextError } = await supabase
    .from("context_nodes")
    .update({ status: "approved", updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("status", "draft");

  if (contextError) {
    return Response.json({ error: contextError.message }, { status: 500 });
  }

  const { error: activeError } = await supabase
    .from("features")
    .update({ status: "active", planning_lock_at: null, updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .in("id", selectedIds);

  if (activeError) {
    return Response.json({ error: activeError.message }, { status: 500 });
  }

  if (heldIds.length) {
    const { error: heldError } = await supabase
      .from("features")
      .update({ status: "on_hold", updated_at: new Date().toISOString() })
      .eq("project_id", projectId)
      .in("id", heldIds);

    if (heldError) {
      return Response.json({ error: heldError.message }, { status: 500 });
    }
  }

  const { error: projectError } = await supabase
    .from("projects")
    .update({ state: "active", updated_at: new Date().toISOString() })
    .eq("id", projectId);

  if (projectError) {
    return Response.json({ error: projectError.message }, { status: 500 });
  }

  await supabase
    .from("project_discovery")
    .update({ stage: "approved", updated_at: new Date().toISOString() })
    .eq("project_id", projectId);

  await supabase.from("events").insert({
    project_id: projectId,
    actor_type: "human",
    event_type: "context_approved",
    payload: { active_feature_ids: selectedIds, held_feature_ids: heldIds },
  });

  return Response.json({ ok: true, activeFeatureIds: selectedIds });
}

