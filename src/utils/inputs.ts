/**
 * Input parsing utilities
 */

import * as core from '@actions/core';
import { CacheInputs } from '../types';

/**
 * Parse all action inputs
 */
export function getInputs(): CacheInputs {
  const path = core.getInput('path', { required: true });
  const key = core.getInput('key', { required: true });
  const restoreKeys = core.getInput('restore-keys');
  const uploadChunkSizeStr = core.getInput('upload-chunk-size');
  const enableCrossOsArchive = core.getBooleanInput('enableCrossOsArchive');
  const failOnCacheMiss = core.getBooleanInput('fail-on-cache-miss');
  const lookupOnly = core.getBooleanInput('lookup-only');
  const environment = core.getInput('environment') as 'prod' | 'dev';
  const fallbackBranch = core.getInput('fallback-branch');
  const backend = core.getInput('backend') as 'github' | 's3' | undefined;

  return {
    path,
    key,
    restoreKeys: restoreKeys || undefined,
    uploadChunkSize: uploadChunkSizeStr ? parseInt(uploadChunkSizeStr, 10) : undefined,
    enableCrossOsArchive,
    failOnCacheMiss,
    lookupOnly,
    environment: environment || 'prod',
    fallbackBranch: fallbackBranch || undefined,
    backend: backend || undefined,
  };
}

/**
 * Parse paths from multiline string
 */
export function parsePaths(pathInput: string): string[] {
  return pathInput
    .split('\n')
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Parse restore keys from multiline string
 */
export function parseRestoreKeys(restoreKeysInput?: string): string[] {
  if (!restoreKeysInput) {
    return [];
  }
  return restoreKeysInput
    .split('\n')
    .map(k => k.trim())
    .filter(k => k.length > 0);
}
