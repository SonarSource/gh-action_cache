/**
 * Backend detection utilities
 */

import * as core from '@actions/core';
import * as github from '@actions/github';

export type CacheBackend = 'github' | 's3';

/**
 * Determine which cache backend to use
 * - If explicitly set via input, use that
 * - For public repos, use GitHub cache
 * - For private/internal repos, use S3 cache
 */
export async function determineBackend(forcedBackend?: string): Promise<CacheBackend> {
  // If explicitly set, use that
  if (forcedBackend === 'github' || forcedBackend === 's3') {
    core.info(`Using forced backend: ${forcedBackend}`);
    return forcedBackend;
  }

  // Try to get visibility from context
  const context = github.context;
  let visibility = (context.payload.repository as { visibility?: string })?.visibility;

  // If not available, try the API
  if (!visibility) {
    try {
      const token = process.env.GITHUB_TOKEN;
      if (token) {
        const octokit = github.getOctokit(token);
        const { data: repo } = await octokit.rest.repos.get({
          owner: context.repo.owner,
          repo: context.repo.repo,
        });
        visibility = repo.visibility;
      }
    } catch (error) {
      core.warning(`Failed to get repository visibility from API: ${error}`);
    }
  }

  core.info(`Repository visibility: ${visibility || 'unknown'}`);

  // Default to S3 for private/internal/unknown
  if (visibility === 'public') {
    core.info('Using GitHub cache for public repository');
    return 'github';
  }

  core.info('Using S3 cache for private/internal repository');
  return 's3';
}
