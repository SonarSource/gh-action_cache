import * as core from '@actions/core';

export interface RetryOptions {
  label: string;
  maxAttempts?: number;
  baseDelayMs?: number;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const { label, maxAttempts = 3, baseDelayMs = 1000 } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }
      const jitter = 0.5 + Math.random() * 0.5;
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
