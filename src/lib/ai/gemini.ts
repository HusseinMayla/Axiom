import { GoogleGenAI } from "@google/genai";
import { getGeminiEnv } from "@/lib/env";

export type AxiomModelTier = "fast" | "smart";
const RATE_LIMIT_RETRY_INTERVAL_MS = 5_000;
const MAX_RATE_LIMIT_WAIT_MS = 100_000;

export function createGeminiClient() {
  return new GoogleGenAI({ apiKey: getGeminiEnv().apiKey });
}

export function getGeminiModel(tier: AxiomModelTier) {
  const env = getGeminiEnv();
  return tier === "smart" ? env.smartModel : env.fastModel;
}

/** Retries Gemini's short rolling quota limits instead of failing a task immediately. */
export async function withGeminiRateLimitRetry<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const startedAt = Date.now();
  while (true) {
    try {
      throwIfAborted(signal);
      return await operation();
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new Error("Gemini operation cancelled.");
      if (!isGeminiRateLimitError(error) || Date.now() - startedAt + RATE_LIMIT_RETRY_INTERVAL_MS > MAX_RATE_LIMIT_WAIT_MS) throw error;
      await waitForRetry(signal);
    }
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new Error("Gemini operation cancelled.");
}

function waitForRetry(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, RATE_LIMIT_RETRY_INTERVAL_MS);
    const onAbort = () => { clearTimeout(timer); reject(signal?.reason ?? new Error("Gemini operation cancelled.")); };
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function isGeminiRateLimitError(error: unknown) {
  const value = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  const message = typeof value?.message === "string" ? value.message.toLowerCase() : "";
  return value?.status === 429 || value?.code === 429 || /\b429\b|rate limit|resource exhausted|quota exceeded/.test(message);
}
