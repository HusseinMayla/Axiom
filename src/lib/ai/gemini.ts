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

/** Project settings store a stable capability name, never a provider model id. */
export function resolveConfiguredGeminiModel(selection: unknown, fallback: AxiomModelTier = "smart") {
  if (selection === "gemini-3.1-flash-lite") return getGeminiModel("fast");
  if (selection === "gemini-3.5-flash") return getGeminiModel("smart");
  return getGeminiModel(fallback);
}

/** Retries Gemini's short rolling quota limits instead of failing a task immediately. */
export async function withGeminiRateLimitRetry<T>(operation: () => Promise<T>, signal?: AbortSignal, onRateLimit?: (info: { attempt: number; elapsedMs: number; retryInMs: number; message: string }) => void | Promise<void>): Promise<T> {
  const startedAt = Date.now();
  let rateLimitAttempt = 0;
  while (true) {
    try {
      throwIfAborted(signal);
      return await operation();
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? new Error("Gemini operation cancelled.");
      if (!isGeminiRateLimitError(error) || Date.now() - startedAt + RATE_LIMIT_RETRY_INTERVAL_MS > MAX_RATE_LIMIT_WAIT_MS) throw error;
      rateLimitAttempt += 1;
      await onRateLimit?.({ attempt: rateLimitAttempt, elapsedMs: Date.now() - startedAt, retryInMs: RATE_LIMIT_RETRY_INTERVAL_MS, message: error instanceof Error ? error.message.slice(0, 600) : "Provider returned a rate-limit response." });
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
