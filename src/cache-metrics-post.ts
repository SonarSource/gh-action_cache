import * as core from '@actions/core';
import {
  CacheMetricsRecord,
  measureCacheBytes,
  readMetricsFile,
  writeMetricsFile,
} from './cache-metrics';

export async function run(): Promise<void> {
  try {
    const metricsFile = core.getState('metricsFile');
    if (!metricsFile) {
      core.info('cache-metrics: no state from main step — skipping post-measurement');
      return;
    }

    const pathInput = core.getState('path');
    const cacheHit = core.getState('cacheHit') === 'true';
    const lookupOnly = core.getState('lookupOnly') === 'true';
    const mode = core.getState('mode');

    // Size measurement requires GNU `du -sb` (Linux only); null on other platforms.
    const sizeBytes = process.platform === 'linux' ? measureCacheBytes(pathInput) : null;
    // The cache action skips save when it found an exact-match hit, when in lookup-only mode, or when the
    // S3 decision mode picked a save-incapable step (`restore-only`/`lookup`).
    const saveIncapable = mode === 'restore-only' || mode === 'lookup';
    const saved = !saveIncapable && !lookupOnly && !cacheHit;

    const prior = readMetricsFile(metricsFile);
    const record: CacheMetricsRecord = {
      step: prior.step ?? 'cache',
      key: prior.key ?? '',
      restore_key_hit: prior.restore_key_hit ?? null,
      backend: prior.backend ?? 'unknown',
      cache_hit: prior.cache_hit ?? cacheHit,
      size_bytes_restored: prior.size_bytes_restored ?? null,
      size_bytes_at_end: sizeBytes,
      saved,
      timestamp_restored: prior.timestamp_restored ?? null,
      timestamp_at_end: new Date().toISOString(),
    };

    writeMetricsFile(metricsFile, record);
    const sizeMsg = sizeBytes === null ? 'n/a (non-Linux)' : `${sizeBytes} B`;
    core.info(`cache-metrics: saved size = ${sizeMsg}, saved=${saved}, updated ${metricsFile}`);
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
