import * as core from '@actions/core';

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 1000;
const JITTER_MIN = 0.5;

export interface RetryOptions {
  label: string;
  maxAttempts?: number;
  baseDelayMs?: number;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { label, maxAttempts = DEFAULT_MAX_ATTEMPTS, baseDelayMs = DEFAULT_BASE_DELAY_MS } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      const jitter = JITTER_MIN + Math.random() * (1 - JITTER_MIN);
      const delayMs = Math.round(baseDelayMs * Math.pow(2, attempt - 1) * jitter);
      const message = error instanceof Error ? error.message : String(error);
      core.warning(
        `${label} failed (attempt ${attempt}/${maxAttempts}): ${message}. Retrying in ${delayMs}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Unreachable, but satisfies TypeScript
  throw new Error(`${label} failed after ${maxAttempts} attempts`);
}
