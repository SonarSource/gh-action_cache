import * as core from '@actions/core';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const AWS_REGION = 'eu-central-1';

export function getAwsDir(): string {
  return path.join(process.env.__TEST_AWS_HOME || os.homedir(), '.aws');
}

export async function writeAwsCredentialsFile(creds: {
  AccessKeyId: string;
  SecretAccessKey: string;
  SessionToken: string;
}): Promise<void> {
  const awsDir = getAwsDir();
  await fs.mkdir(awsDir, { recursive: true, mode: 0o700 });

  const credentialsContent = [
    '[default]',
    `aws_access_key_id = ${creds.AccessKeyId}`,
    `aws_secret_access_key = ${creds.SecretAccessKey}`,
    `aws_session_token = ${creds.SessionToken}`,
    '',
  ].join('\n');

  const configContent = ['[default]', `region = ${AWS_REGION}`, ''].join('\n');

  await fs.writeFile(path.join(awsDir, 'credentials'), credentialsContent, {
    mode: 0o600,
  });
  await fs.writeFile(path.join(awsDir, 'config'), configContent, {
    mode: 0o600,
  });

  core.info(
    'Wrote credentials to ~/.aws/credentials [default] profile (fallback for nested composites)'
  );
}

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

    await writeAwsCredentialsFile(creds);

    core.info('Cache credentials restored for post-step cache save');
  } catch (error) {
    core.warning(`Failed to restore credentials: ${error instanceof Error ? error.message : error}`);
  }
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
