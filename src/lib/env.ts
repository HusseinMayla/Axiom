const hasValue = (value: string | undefined) => Boolean(value && value.trim().length > 0);

export function setupStatus() {
  const supabase = hasValue(process.env.NEXT_PUBLIC_SUPABASE_URL) && hasValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  const gemini = hasValue(process.env.GEMINI_API_KEY);

  return { supabase, gemini, complete: supabase && gemini };
}

export function getPublicSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env.local.");
  }

  return { url, publishableKey };
}

export function getGeminiEnv() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Gemini is not configured. Add GEMINI_API_KEY to .env.local.");
  }

  return {
    apiKey,
    fastModel: hasValue(process.env.GEMINI_MODEL_FAST) ? process.env.GEMINI_MODEL_FAST! : "gemini-3.1-flash-lite",
    smartModel: hasValue(process.env.GEMINI_MODEL_SMART)
      ? process.env.GEMINI_MODEL_SMART!
      : (hasValue(process.env.GEMINI_MODEL_FAST) ? process.env.GEMINI_MODEL_FAST! : "gemini-3.1-flash-lite"),
  };
}

export function getGithubAppEnv() {
  const appId = process.env.GITHUB_APP_ID;
  const slug = process.env.GITHUB_APP_SLUG;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !slug || !privateKey) {
    throw new Error("GitHub App is not configured. Add GITHUB_APP_ID, GITHUB_APP_SLUG, and GITHUB_APP_PRIVATE_KEY to .env.local.");
  }

  return { appId, slug, privateKey: privateKey.replace(/\\n/g, "\n") };
}
