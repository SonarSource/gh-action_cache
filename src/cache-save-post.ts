import * as core from '@actions/core';
import { shouldSkipSave } from './cache-save-decision';
import { computeContentDigest } from './content-manifest';
import { runRunsOnSave } from './runs-on-save';

export async function run(): Promise<void> {
  try {
    const key = core.getState('key');
    const path = core.getState('path');
    const matchedKey = core.getState('matched-key');
    const fallbackExactKey = core.getState('fallback-exact-key');
    const lookupOnly = core.getState('lookup-only') === 'true';
    const enabled = core.getState('skip-redundant-save') === 'true';
    const enableCrossOsArchive = core.getState('enable-cross-os-archive') === 'true';

    if (!key) {
      core.warning('No cache key in state — skipping save');
      return;
    }

    // Only recompute the content digest if the main step recorded a baseline (i.e. this was a
    // skip candidate). Otherwise there is nothing to compare against and we save unconditionally.
    const baselineDigest = core.getState('baseline-digest');
    const finalDigest = baselineDigest ? await computeContentDigest(path) : '';

    const decision = shouldSkipSave({
      key,
      matchedKey,
      fallbackExactKey,
      lookupOnly,
      enabled,
      baselineDigest,
      finalDigest,
    });
    if (decision.skip) {
      if (decision.reason === 'exact-key-hit') {
        core.info(`Cache hit on the primary key '${key}'; not saving.`);
      } else if (decision.reason === 'restored-from-default-branch-fallback') {
        core.info(
          `Cache content is identical to the default-branch cache ` +
            `(restored '${matchedKey}'); skipping redundant save of '${key}'.`
        );
      } else {
        core.info(`Skipping cache save (${decision.reason}).`);
      }
      return;
    }

    if (decision.reason === 'content-changed-since-restore') {
      core.info(`Cache content changed since restore; saving '${key}'.`);
    } else {
      core.info(`Saving cache with key '${key}'`);
    }
    await runRunsOnSave({ key, path, enableCrossOsArchive });
  } catch (error) {
    core.warning(`Cache save failed: ${error instanceof Error ? error.message : error}`);
  }
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
