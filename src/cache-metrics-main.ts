import * as core from '@actions/core';
import {
  CacheMetricsRecord,
  measureCacheBytes,
  metricsFilePath,
  readInputs,
  slugifyStepId,
  writeMetricsFile,
} from './cache-metrics';

export async function run(): Promise<void> {
  try {
    const inputs = readInputs();
    const slug = slugifyStepId(inputs.stepId);
    const file = metricsFilePath(inputs.metricsDir, slug);

    // Size measurement requires GNU `du -sb` (Linux only); null on other platforms.
    const sizeBytes = process.platform === 'linux' ? measureCacheBytes(inputs.path) : null;
    const timestamp = new Date().toISOString();

    // `matchedKey` is the underlying cache action's `cache-matched-key` output:
    //   - exact hit  → equal to `inputs.key` (the primary key); `cacheHit` is true.
    //   - partial    → equal to one of the user-provided restore keys; `cacheHit` is false.
    //   - no match   → empty string; `cacheHit` is false.
    // Under the cache-action contract `cacheHit === isExactKeyMatch(primaryKey, matchedKey)`,
    // so `!cacheHit && matchedKey` already implies a partial hit. Mirrors the action.yml
    // expression for the `restore-key-hit` top-level output exactly.
    const restoreKeyHit = !inputs.cacheHit && inputs.matchedKey ? inputs.matchedKey : null;

    const record: CacheMetricsRecord = {
      step: slug,
      key: inputs.key,
      restore_key_hit: restoreKeyHit,
      backend: inputs.backend,
      cache_hit: inputs.cacheHit,
      size_bytes_restored: sizeBytes,
      size_bytes_at_end: null,
      saved: null,
      timestamp_restored: timestamp,
      timestamp_at_end: null,
    };

    writeMetricsFile(file, record);
    if (sizeBytes !== null) {
      core.setOutput('cache-size-bytes', sizeBytes);
    }

    // Stash inputs for the post step (it does not receive `with:` again).
    core.saveState('metricsFile', file);
    core.saveState('path', inputs.path);
    core.saveState('cacheHit', inputs.cacheHit ? 'true' : 'false');
    core.saveState('lookupOnly', inputs.lookupOnly ? 'true' : 'false');

    const sizeMsg = sizeBytes === null ? 'n/a (non-Linux)' : `${sizeBytes} B`;
    core.info(`cache-metrics: restored size = ${sizeMsg}, metrics written to ${file}`);
  } catch (error) {
    // Fail-open: metrics issues must never break the cache flow.
    core.warning(
      `cache-metrics (main) failed: ${error instanceof Error ? error.message : error}`
    );
  }
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
