import * as core from '@actions/core';

export async function run(): Promise<void> {
  const cacheMetricsActionPath = core.getInput('cache-metrics-action-path');
  if (cacheMetricsActionPath) {
    core.saveState('cache-metrics-action-path', cacheMetricsActionPath);
  }
  core.info(`Symlink keeper registered (cache-metrics-action-path: ${cacheMetricsActionPath || '<empty>'})`);
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
