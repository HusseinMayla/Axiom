import { NextRequest } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export async function POST(request: NextRequest) {
  const parsed = createProjectSchema.safeParse(await request.json());

  if (!parsed.success) {
    return Response.json({ error: "A project name is required." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ error: "Sign in before creating a project." }, { status: 401 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({ name: parsed.data.name, owner_id: user.id })
    .select("id, name")
    .single();

  if (projectError || !project) {
    return Response.json({ error: projectError?.message ?? "Could not create the project." }, { status: 500 });
  }

  const { error: discoveryError } = await supabase
    .from("project_discovery")
    .insert({ project_id: project.id });

  if (discoveryError) {
    return Response.json({ error: discoveryError.message }, { status: 500 });
  }

  return Response.json({ project }, { status: 201 });
}

