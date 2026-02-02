/**
 * Post entry point for gh-action_cache
 * Handles cache saving after job completion
 */

import * as core from '@actions/core';
import { saveToS3 } from './cache/s3';
import { saveToGitHub } from './cache/github';
import { getState, getAwsCredentials, STATE_KEYS } from './state/stateManager';
import { parsePaths } from './utils/inputs';

async function run(): Promise<void> {
  try {
    const backend = getState(STATE_KEYS.BACKEND);
    const cacheHit = getState(STATE_KEYS.CACHE_HIT) === 'true';
    const matchedKey = getState(STATE_KEYS.MATCHED_KEY);
    const pathInput = getState(STATE_KEYS.PATH);

    if (!backend || !pathInput) {
      core.warning('Missing state from main step, skipping cache save');
      return;
    }

    const paths = parsePaths(pathInput);

    if (backend === 'github') {
      const primaryKey = getState(STATE_KEYS.PRIMARY_KEY);

      // Skip if exact cache hit on primary key
      if (cacheHit) {
        core.info('Cache hit on primary key, skipping save');
        return;
      }

      const uploadChunkSizeStr = getState(STATE_KEYS.UPLOAD_CHUNK_SIZE);
      const enableCrossOsArchive = getState(STATE_KEYS.ENABLE_CROSS_OS_ARCHIVE) === 'true';

      await saveToGitHub({
        paths,
        key: primaryKey,
        uploadChunkSize: uploadChunkSizeStr ? parseInt(uploadChunkSizeStr, 10) : undefined,
        enableCrossOsArchive,
      });
    } else {
      // S3 Backend
      const branchKey = getState(STATE_KEYS.BRANCH_KEY);

      // Skip if exact cache hit on branch key
      if (cacheHit && matchedKey === branchKey) {
        core.info('Cache hit on primary key, skipping save');
        return;
      }

      // Retrieve credentials from GITHUB_STATE
      const credentials = getAwsCredentials();

      if (!credentials) {
        core.warning('No AWS credentials in state, skipping cache save');
        return;
      }

      const bucket = getState(STATE_KEYS.S3_BUCKET);
      const uploadChunkSizeStr = getState(STATE_KEYS.UPLOAD_CHUNK_SIZE);

      if (!bucket) {
        core.warning('No S3 bucket in state, skipping cache save');
        return;
      }

      await saveToS3({
        paths,
        key: branchKey,
        credentials,
        bucket,
        uploadChunkSize: uploadChunkSizeStr ? parseInt(uploadChunkSizeStr, 10) : undefined,
      });
    }

    core.info('Cache save completed');
  } catch (error) {
    // Don't fail the job on cache save errors
    if (error instanceof Error) {
      core.warning(`Cache save failed: ${error.message}`);
    } else {
      core.warning('Cache save failed with an unexpected error');
    }
  }
}

run();
