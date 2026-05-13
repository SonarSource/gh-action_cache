import * as core from '@actions/core';
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

    const sizeBytes = measureCacheBytes(pathInput);
    // The cache action skips save when it found an exact-match hit, or when in lookup-only mode.
    const saved = !lookupOnly && !cacheHit;

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
