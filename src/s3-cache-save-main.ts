import * as core from '@actions/core';
import { State } from './runs-on-cache/constants';

/**
 * Seeds GITHUB_STATE for the post-step save so it can apply the same skip rules as
 * actions/cache without requiring a bundled restore+save action instance.
 */
export async function run(): Promise<void> {
  const cachePrimaryKey = core.getInput('cache-primary-key', { required: true });
  const cacheMatchedKey = core.getInput('cache-matched-key');

  core.saveState(State.CachePrimaryKey, cachePrimaryKey);
  if (cacheMatchedKey) {
    core.saveState(State.CacheMatchedKey, cacheMatchedKey);
  }

  core.info('S3 cache save registered for post-step');
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
