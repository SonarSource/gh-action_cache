import * as core from '@actions/core';

export async function run(): Promise<void> {
  try {
    core.saveState('key', core.getInput('key'));
    core.saveState('path', core.getInput('path'));
    core.saveState('matched-key', core.getInput('matched-key'));
    core.saveState('fallback-exact-key', core.getInput('fallback-exact-key'));
    core.saveState('lookup-only', String(core.getBooleanInput('lookup-only')));
    core.saveState('skip-redundant-save', String(core.getBooleanInput('skip-redundant-save')));
    core.saveState('enable-cross-os-archive', String(core.getBooleanInput('enable-cross-os-archive')));
    core.info('cache-save registered; save decision deferred to post step');
  } catch (error) {
    core.setFailed(`cache-save setup failed: ${error instanceof Error ? error.message : error}`);
  }
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
