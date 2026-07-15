import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const discoverySchema = z.object({
  answers: z.record(z.string(), z.string().max(10000)),
  stage: z.enum(["draft", "submitted", "clarifying", "ready_for_review", "approved"]),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const parsed = discoverySchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json({ error: "The discovery brief is not valid." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Sign in before saving a discovery brief." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("project_discovery")
    .update({ answers: parsed.data.answers, stage: parsed.data.stage, updated_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .select("id")
    .single();

  if (error || !data) {
    return Response.json({ error: error?.message ?? "Could not save the discovery brief." }, { status: 500 });
  }

  return Response.json({ ok: true });
}

