import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseEnv } from "@/lib/env";

export function createSupabaseBrowserClient() {
  const { url, publishableKey } = getPublicSupabaseEnv();
  return createBrowserClient(url, publishableKey);
}

