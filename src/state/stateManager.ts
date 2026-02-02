/**
 * State Manager for passing data between main and post steps
 * Uses GITHUB_STATE which is invisible to user steps
 */

import * as core from '@actions/core';

export const STATE_KEYS = {
  BACKEND: 'backend',
  PATH: 'cachePath',
  PRIMARY_KEY: 'primaryKey',
  BRANCH_KEY: 'branchKey',
  CACHE_HIT: 'cacheHit',
  MATCHED_KEY: 'matchedKey',
  AWS_ACCESS_KEY_ID: 'awsAccessKeyId',
  AWS_SECRET_ACCESS_KEY: 'awsSecretAccessKey',
  AWS_SESSION_TOKEN: 'awsSessionToken',
  AWS_REGION: 'awsRegion',
  S3_BUCKET: 's3Bucket',
  UPLOAD_CHUNK_SIZE: 'uploadChunkSize',
  ENABLE_CROSS_OS_ARCHIVE: 'enableCrossOsArchive',
} as const;

export type StateKey = typeof STATE_KEYS[keyof typeof STATE_KEYS];

/**
 * Save a value to GITHUB_STATE
 * This value will be available in the post step via STATE_<key> env var
 */
export function saveState(key: StateKey, value: string): void {
  core.saveState(key, value);
}

/**
 * Get a value from GITHUB_STATE (available in post step)
 * In post step, this reads from STATE_<key> env var
 */
export function getState(key: StateKey): string {
  return core.getState(key);
}

/**
 * Save all AWS credentials to state
 */
export function saveAwsCredentials(credentials: {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  region: string;
}): void {
  saveState(STATE_KEYS.AWS_ACCESS_KEY_ID, credentials.accessKeyId);
  saveState(STATE_KEYS.AWS_SECRET_ACCESS_KEY, credentials.secretAccessKey);
  saveState(STATE_KEYS.AWS_SESSION_TOKEN, credentials.sessionToken);
  saveState(STATE_KEYS.AWS_REGION, credentials.region);
}

/**
 * Retrieve AWS credentials from state (in post step)
 */
export function getAwsCredentials(): {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  region: string;
} | null {
  const accessKeyId = getState(STATE_KEYS.AWS_ACCESS_KEY_ID);
  const secretAccessKey = getState(STATE_KEYS.AWS_SECRET_ACCESS_KEY);
  const sessionToken = getState(STATE_KEYS.AWS_SESSION_TOKEN);
  const region = getState(STATE_KEYS.AWS_REGION);

  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    return null;
  }

  return { accessKeyId, secretAccessKey, sessionToken, region };
}
