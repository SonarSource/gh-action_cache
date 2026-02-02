/**
 * GitHub OIDC Token Retrieval with Exponential Backoff
 * Ported from scripts/get-github-token.sh
 */

import * as core from '@actions/core';
import * as httpm from '@actions/http-client';

const MAX_ATTEMPTS = 5;
const INITIAL_TIMEOUT = 10000; // 10 seconds
const MAX_TIMEOUT = 60000; // 60 seconds

interface OidcTokenResponse {
  value: string;
}

/**
 * Get GitHub OIDC token for the specified audience
 */
export async function getGitHubOidcToken(audience: string): Promise<string> {
  const tokenUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const tokenToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

  if (!tokenUrl || !tokenToken) {
    throw new Error(
      'OIDC token request environment variables not set. ' +
      'Ensure the job has "id-token: write" permission.'
    );
  }

  let timeout = INITIAL_TIMEOUT;
  const client = new httpm.HttpClient('gh-action-cache', [], {
    allowRetries: false, // We handle retries ourselves
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const requestUrl = `${tokenUrl}&audience=${encodeURIComponent(audience)}`;

      const response = await client.getJson<OidcTokenResponse>(
        requestUrl,
        {
          Authorization: `bearer ${tokenToken}`,
        }
      );

      if (response.result?.value) {
        core.debug('Successfully obtained OIDC token');
        return response.result.value;
      }

      core.warning(
        `Attempt ${attempt}/${MAX_ATTEMPTS}: Invalid token response (empty value)`
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
        core.warning(
          `Attempt ${attempt}/${MAX_ATTEMPTS}: Operation timeout after ${timeout}ms`
        );
      } else if (errorMessage.includes('ECONNREFUSED')) {
        core.warning(
          `Attempt ${attempt}/${MAX_ATTEMPTS}: Failed to connect`
        );
      } else if (errorMessage.includes('ENOTFOUND')) {
        core.warning(
          `Attempt ${attempt}/${MAX_ATTEMPTS}: Could not resolve host`
        );
      } else {
        core.warning(
          `Attempt ${attempt}/${MAX_ATTEMPTS}: ${errorMessage}`
        );
      }
    }

    // Exponential backoff with jitter
    if (attempt < MAX_ATTEMPTS) {
      const baseWait = Math.pow(2, attempt) * 1000;
      const jitter = Math.floor(Math.random() * 3000);
      const waitTime = baseWait + jitter;

      core.warning(`Retrying in ${Math.round(waitTime / 1000)}s...`);
      await sleep(waitTime);

      // Increase timeout for next attempt
      timeout = Math.min(timeout * 2, MAX_TIMEOUT);
    }
  }

  throw new Error(
    `Failed to obtain GitHub Actions OIDC token after ${MAX_ATTEMPTS} attempts. ` +
    'This may indicate network issues or GitHub Actions service problems. ' +
    'Check GitHub Actions status: https://www.githubstatus.com/'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
