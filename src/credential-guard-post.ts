import * as core from '@actions/core';
import * as fs from 'fs/promises';

const AWS_REGION = 'eu-central-1';

export async function run(): Promise<void> {
  const credentialsFile = core.getState('credentials-file');
  if (!credentialsFile) {
    core.warning('No credentials file path in state — skipping credential restore');
    return;
  }

  try {
    const content = await fs.readFile(credentialsFile, 'utf-8');
    const creds = JSON.parse(content);

    // Defensive: re-mask credentials in case setSecret scope changes
    if (creds.AccessKeyId) core.setSecret(creds.AccessKeyId);
    if (creds.SecretAccessKey) core.setSecret(creds.SecretAccessKey);
    if (creds.SessionToken) core.setSecret(creds.SessionToken);

    if (!creds.AccessKeyId || !creds.SecretAccessKey || !creds.SessionToken) {
      core.warning('Credentials file is missing required fields — skipping');
      return;
    }

    core.exportVariable('AWS_ACCESS_KEY_ID', creds.AccessKeyId);
    core.exportVariable('AWS_SECRET_ACCESS_KEY', creds.SecretAccessKey);
    core.exportVariable('AWS_SESSION_TOKEN', creds.SessionToken);
    core.exportVariable('AWS_REGION', AWS_REGION);
    core.exportVariable('AWS_DEFAULT_REGION', AWS_REGION);
    // Clear profile-based config so AWS SDK uses fromEnv() instead of fromIni().
    // Safe here because this is a post step — no user code runs after it.
    core.exportVariable('AWS_PROFILE', '');
    core.exportVariable('AWS_DEFAULT_PROFILE', '');

    core.info('Cache credentials restored for post-step cache save');
  } catch (error) {
    core.warning(`Failed to restore credentials: ${error instanceof Error ? error.message : error}`);
  }
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
