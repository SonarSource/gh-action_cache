/**
 * Cache key preparation with branch-specific paths and fallback logic
 * Ported from scripts/prepare-keys.sh
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import { CacheInputs, PreparedKeys } from '../types';

const SUPPORTED_FALLBACK_PATTERNS = ['main', 'master'];
const BRANCH_PATTERN_PREFIX = 'branch-';

/**
 * Prepare cache keys with branch-specific prefixes and fallback logic
 */
export async function prepareKeys(inputs: CacheInputs): Promise<PreparedKeys> {
  const branchName = getBranchName();
  const branchKey = `${branchName}/${inputs.key}`;

  core.info(`Branch: ${branchName}`);
  core.info(`Branch key: ${branchKey}`);

  const restoreKeys: string[] = [];

  if (inputs.restoreKeys) {
    const inputRestoreKeys = inputs.restoreKeys
      .split('\n')
      .map(k => k.trim())
      .filter(k => k.length > 0);

    // First, add branch-specific restore keys
    for (const key of inputRestoreKeys) {
      restoreKeys.push(`${branchName}/${key}`);
    }

    // Then add fallback branch restore keys
    const fallbackBranch = await getFallbackBranch(inputs.fallbackBranch);

    if (fallbackBranch && fallbackBranch !== branchName) {
      core.info(`Adding fallback restore keys for branch: ${fallbackBranch}`);
      for (const key of inputRestoreKeys) {
        restoreKeys.push(`refs/heads/${fallbackBranch}/${key}`);
      }
    }
  }

  core.debug(`Restore keys: ${JSON.stringify(restoreKeys)}`);

  return {
    branchKey,
    restoreKeys,
  };
}

/**
 * Get the current branch name
 * Uses GITHUB_HEAD_REF for PR events, GITHUB_REF for push events
 */
function getBranchName(): string {
  // For pull requests, GITHUB_HEAD_REF contains the source branch
  const headRef = process.env.GITHUB_HEAD_REF;
  if (headRef) {
    return headRef;
  }

  // For push events, use GITHUB_REF (e.g., refs/heads/main)
  const ref = process.env.GITHUB_REF || '';
  return ref;
}

/**
 * Get the fallback branch for cache restoration
 * - If explicitly set, validate and use that
 * - Otherwise, query GitHub API for default branch
 */
async function getFallbackBranch(
  inputFallbackBranch?: string
): Promise<string | null> {
  let fallbackBranch: string | null = null;

  if (inputFallbackBranch) {
    // Remove refs/heads/ prefix if present
    fallbackBranch = inputFallbackBranch.replace(/^refs\/heads\//, '');
  } else {
    // Try to get default branch from GitHub API
    fallbackBranch = await getDefaultBranch();
  }

  if (!fallbackBranch) {
    core.warning('Unable to determine fallback branch; skipping fallback restore keys.');
    return null;
  }

  // Validate fallback branch
  if (!isValidFallbackBranch(fallbackBranch)) {
    core.warning(
      `Fallback branch '${fallbackBranch}' is not supported for cache fallback. ` +
      `Supported branches: main, master, branch-*`
    );
    return null;
  }

  return fallbackBranch;
}

/**
 * Get default branch from GitHub API
 */
async function getDefaultBranch(): Promise<string | null> {
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      core.debug('No GITHUB_TOKEN available, cannot query default branch');
      return null;
    }

    const context = github.context;
    const octokit = github.getOctokit(token);

    const { data: repo } = await octokit.rest.repos.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
    });

    return repo.default_branch;
  } catch (error) {
    core.debug(`Failed to get default branch from API: ${error}`);
    return null;
  }
}

/**
 * Check if a branch is valid for fallback cache restoration
 */
function isValidFallbackBranch(branch: string): boolean {
  // Check for exact matches (main, master)
  if (SUPPORTED_FALLBACK_PATTERNS.includes(branch)) {
    return true;
  }

  // Check for branch-* pattern
  if (branch.startsWith(BRANCH_PATTERN_PREFIX)) {
    return true;
  }

  return false;
}
