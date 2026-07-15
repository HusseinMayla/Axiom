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
    fastModel: process.env.GEMINI_MODEL_FAST ?? "gemini-3.1-flash-lite",
    smartModel: process.env.GEMINI_MODEL_SMART ?? "gemini-3.5-flash",
  };
}

