/**
 * GitHub Actions Cache wrapper
 * Uses @actions/cache for public repositories
 */

import * as core from '@actions/core';
import * as cache from '@actions/cache';
import { CacheRestoreResult } from '../types';

/**
 * Restore cache using GitHub Actions cache
 */
export async function restoreFromGitHub(options: {
  paths: string[];
  primaryKey: string;
  restoreKeys: string[];
  lookupOnly: boolean;
  enableCrossOsArchive: boolean;
  failOnCacheMiss: boolean;
}): Promise<CacheRestoreResult> {
  core.info(`Looking for cache with primary key: ${options.primaryKey}`);

  try {
    const matchedKey = await cache.restoreCache(
      options.paths,
      options.primaryKey,
      options.restoreKeys,
      {
        lookupOnly: options.lookupOnly,
      },
      options.enableCrossOsArchive
    );

    if (matchedKey) {
      core.info(`Cache found: ${matchedKey}`);
      return {
        exactMatch: matchedKey === options.primaryKey,
        matchedKey,
      };
    }

    core.info('Cache not found');

    if (options.failOnCacheMiss) {
      throw new Error(
        `Cache entry not found for key: ${options.primaryKey}`
      );
    }

    return {
      exactMatch: false,
      matchedKey: null,
    };
  } catch (error) {
    if (error instanceof cache.ReserveCacheError) {
      core.warning(`Cache reservation failed: ${error.message}`);
      return {
        exactMatch: false,
        matchedKey: null,
      };
    }
    throw error;
  }
}

/**
 * Save cache using GitHub Actions cache
 */
export async function saveToGitHub(options: {
  paths: string[];
  key: string;
  uploadChunkSize?: number;
  enableCrossOsArchive: boolean;
}): Promise<void> {
  core.info(`Saving cache with key: ${options.key}`);

  try {
    await cache.saveCache(
      options.paths,
      options.key,
      {
        uploadChunkSize: options.uploadChunkSize,
      },
      options.enableCrossOsArchive
    );

    core.info('Cache saved successfully');
  } catch (error) {
    if (error instanceof cache.ReserveCacheError) {
      core.warning(`Cache already exists for key: ${options.key}`);
      return;
    }
    throw error;
  }
}
