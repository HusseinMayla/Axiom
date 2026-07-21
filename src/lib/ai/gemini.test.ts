import { afterEach, describe, expect, it, vi } from "vitest";
import { withGeminiRateLimitRetry } from "./gemini";

afterEach(() => vi.useRealTimers());

describe("withGeminiRateLimitRetry", () => {
  it("retries a short rolling quota response every five seconds", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const operation = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw { status: 429, message: "rate limit exceeded" };
      return "recovered";
    });

    const result = withGeminiRateLimitRetry(operation);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toBe("recovered");
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-rate-limit error", async () => {
    const operation = vi.fn(async () => { throw new Error("invalid API key"); });

    await expect(withGeminiRateLimitRetry(operation)).rejects.toThrow("invalid API key");
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("stops after one hundred seconds of continuous quota responses", async () => {
    vi.useFakeTimers();
    const quotaError = { status: 429, message: "quota exceeded" };
    const operation = vi.fn(async () => { throw quotaError; });

    const result = withGeminiRateLimitRetry(operation);
    const rejection = expect(result).rejects.toBe(quotaError);
    await vi.advanceTimersByTimeAsync(100_000);

    await rejection;
    expect(operation).toHaveBeenCalledTimes(21);
  });

  it("stops a quota retry wait immediately when cancelled", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const operation = vi.fn(async () => { throw { status: 429, message: "quota exceeded" }; });
    const result = withGeminiRateLimitRetry(operation, controller.signal);
    const cancellation = new Error("cancelled by human");
    const rejection = expect(result).rejects.toBe(cancellation);

    controller.abort(cancellation);
    await rejection;
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
