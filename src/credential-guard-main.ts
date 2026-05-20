import * as core from '@actions/core';

export async function run(): Promise<void> {
  try {
    const credentialsFile = core.getInput('credentials-file', { required: true });
    core.saveState('credentials-file', credentialsFile);

    // Optional: address path used by the post step to recreate the workspace symlink
    // `.actions/cache-metrics` if a nested actions/checkout wiped it between cache-metrics
    // main and post. Empty when CI_METRICS_ENABLED is off or this is a non-Linux run.
    const cacheMetricsActionPath = core.getInput('cache-metrics-action-path');
    if (cacheMetricsActionPath) {
      core.saveState('cache-metrics-action-path', cacheMetricsActionPath);
    }

    core.info(`Credential guard registered (file: ${credentialsFile})`);
    core.info('Credentials will be restored in post-step before cache save');
  } catch (error) {
    core.setFailed(`Credential guard setup failed: ${error instanceof Error ? error.message : error}`);
  }
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
