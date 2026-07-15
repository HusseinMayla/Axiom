import { setupStatus } from "@/lib/env";

export function GET() {
  const setup = setupStatus();

  return Response.json({
    service: "axiom",
    phase: 1,
    configured: setup.complete,
    services: {
      supabase: setup.supabase,
      gemini: setup.gemini,
    },
  });
}

