import * as core from '@actions/core';
import { shouldSkipDuplicateCacheSave } from './cache-save-skip';
import {
  CacheMetricsRecord,
  measureCacheBytes,
  readMetricsFile,
  writeMetricsFile,
} from './cache-metrics';

export async function run(): Promise<void> {
  try {
    if (process.platform !== 'linux') {
      return;
    }

    const metricsFile = core.getState('metricsFile');
    if (!metricsFile) {
      core.info('cache-metrics: no state from main step — skipping post-measurement');
      return;
    }

    const pathInput = core.getState('path');
    const cacheHit = core.getState('cacheHit') === 'true';
    const lookupOnly = core.getState('lookupOnly') === 'true';
    const cacheUserKey = core.getState('cacheUserKey') ?? '';
    const cachePrimaryKey = core.getState('cachePrimaryKey') ?? '';
    const cacheMatchedKey = core.getState('cacheMatchedKey') ?? '';

    const sizeBytes = measureCacheBytes(pathInput);
    const skipDuplicateSave = shouldSkipDuplicateCacheSave(
      cacheHit,
      cachePrimaryKey,
      cacheMatchedKey,
      cacheUserKey
    );
    // The cache action skips save on exact hit, lookup-only, or unchanged content after fallback restore.
    const saved = !lookupOnly && !cacheHit && !skipDuplicateSave;

    const prior = readMetricsFile(metricsFile);
    const record: CacheMetricsRecord = {
      step: prior.step ?? 'cache',
      key: prior.key ?? '',
      'restore-key-hit': prior['restore-key-hit'] ?? null,
      backend: prior.backend ?? 'unknown',
      'cache-hit': prior['cache-hit'] ?? cacheHit,
      'size-bytes-restored': prior['size-bytes-restored'] ?? null,
      'size-bytes-at-end': sizeBytes,
      saved,
      'timestamp-restored': prior['timestamp-restored'] ?? null,
      'timestamp-at-end': new Date().toISOString(),
    };

    writeMetricsFile(metricsFile, record);
    core.info(
      `cache-metrics: saved size = ${sizeBytes} B, saved=${saved}, updated ${metricsFile}`
    );
  } catch (error) {
    // Fail-open: metrics issues must never break the cache flow.
    core.warning(
      `cache-metrics (post) failed: ${error instanceof Error ? error.message : error}`
    );
  }
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
