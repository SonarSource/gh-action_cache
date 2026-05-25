import * as core from '@actions/core';

export async function run(): Promise<void> {
  try {
    const credentialsFile = core.getInput('credentials-file', { required: true });
    core.saveState('credentials-file', credentialsFile);
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
