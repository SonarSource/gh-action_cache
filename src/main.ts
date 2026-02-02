/**
 * Main entry point for gh-action_cache
 * Handles cache restoration
 */

import * as core from '@actions/core';
import { authenticateAws } from './auth/cognito';
import { restoreFromS3 } from './cache/s3';
import { restoreFromGitHub } from './cache/github';
import { prepareKeys } from './keys/prepareKeys';
import { saveState, saveAwsCredentials, STATE_KEYS } from './state/stateManager';
import { determineBackend } from './utils/backend';
import { getInputs, parsePaths, parseRestoreKeys } from './utils/inputs';

async function run(): Promise<void> {
  try {
    const inputs = getInputs();
    const backend = await determineBackend(inputs.backend);
    const paths = parsePaths(inputs.path);

    // Save state for post step
    saveState(STATE_KEYS.BACKEND, backend);
    saveState(STATE_KEYS.PATH, inputs.path);
    saveState(STATE_KEYS.PRIMARY_KEY, inputs.key);
    saveState(STATE_KEYS.ENABLE_CROSS_OS_ARCHIVE, String(inputs.enableCrossOsArchive));

    if (inputs.uploadChunkSize) {
      saveState(STATE_KEYS.UPLOAD_CHUNK_SIZE, String(inputs.uploadChunkSize));
    }

    if (backend === 'github') {
      // Use GitHub Actions cache for public repositories
      const restoreKeys = parseRestoreKeys(inputs.restoreKeys);

      const result = await restoreFromGitHub({
        paths,
        primaryKey: inputs.key,
        restoreKeys,
        lookupOnly: inputs.lookupOnly,
        enableCrossOsArchive: inputs.enableCrossOsArchive,
        failOnCacheMiss: inputs.failOnCacheMiss,
      });

      core.setOutput('cache-hit', String(result.exactMatch));
      saveState(STATE_KEYS.CACHE_HIT, String(result.exactMatch));
      saveState(STATE_KEYS.MATCHED_KEY, result.matchedKey || '');
    } else {
      // S3 Backend for private/internal repositories
      const credentials = await authenticateAws(inputs.environment);
      const bucket = `sonarsource-s3-cache-${inputs.environment}-bucket`;

      // Save credentials to GITHUB_STATE (NOT to GITHUB_ENV!)
      // These will be available in post step via STATE_* env vars
      saveAwsCredentials(credentials);
      saveState(STATE_KEYS.S3_BUCKET, bucket);

      // Prepare branch-specific keys
      const { branchKey, restoreKeys } = await prepareKeys(inputs);
      saveState(STATE_KEYS.BRANCH_KEY, branchKey);

      // Restore cache from S3
      const result = await restoreFromS3({
        paths,
        primaryKey: branchKey,
        restoreKeys,
        credentials,
        bucket,
        lookupOnly: inputs.lookupOnly,
      });

      core.setOutput('cache-hit', String(result.exactMatch));
      saveState(STATE_KEYS.CACHE_HIT, String(result.exactMatch));
      saveState(STATE_KEYS.MATCHED_KEY, result.matchedKey || '');

      // Handle fail-on-cache-miss
      if (inputs.failOnCacheMiss && !result.matchedKey) {
        throw new Error(`Cache entry not found for key: ${branchKey}`);
      }
    }

    core.info('Cache restore completed');
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

run();
