import * as core from '@actions/core';
import { computeContentDigest } from './content-manifest';

export async function run(): Promise<void> {
  try {
    const key = core.getInput('key');
    const path = core.getInput('path');
    const matchedKey = core.getInput('matched-key');
    const fallbackExactKey = core.getInput('fallback-exact-key');
    const lookupOnly = core.getBooleanInput('lookup-only');
    const skipRedundantSave = core.getBooleanInput('skip-redundant-save');
    const enableCrossOsArchive = core.getBooleanInput('enable-cross-os-archive');

    core.saveState('key', key);
    core.saveState('path', path);
    core.saveState('matched-key', matchedKey);
    core.saveState('fallback-exact-key', fallbackExactKey);
    core.saveState('lookup-only', String(lookupOnly));
    core.saveState('skip-redundant-save', String(skipRedundantSave));
    core.saveState('enable-cross-os-archive', String(enableCrossOsArchive));

    // Only a fallback-exact restore can lead to a skip, so only then is a baseline content digest
    // worth computing. On every other path (miss, exact-key hit, disabled, lookup-only) the save
    // happens regardless, so we skip the (potentially large) filesystem walk entirely.
    const skipCandidate = skipRedundantSave && !lookupOnly && !!fallbackExactKey && matchedKey === fallbackExactKey;
    const baselineDigest = skipCandidate ? await computeContentDigest(path) : '';
    core.saveState('baseline-digest', baselineDigest);

    core.info('cache-save registered; save decision deferred to post step');
  } catch (error) {
    core.setFailed(`cache-save setup failed: ${error instanceof Error ? error.message : error}`);
  }
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
