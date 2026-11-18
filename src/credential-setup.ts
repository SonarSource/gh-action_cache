import * as core from '@actions/core';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { getCognitoCredentials } from './auth';

const POOL_IDS: Record<string, string> = {
  prod: 'eu-central-1:511fe374-ae4f-46d0-adb7-9246e570c7f4',
  dev: 'eu-central-1:3221c6ea-3f67-4fd8-a7ff-7426f96add89',
};

const ACCOUNT_IDS: Record<string, string> = {
  prod: '275878209202',
  dev: '460386131003',
};

const AWS_REGION = 'eu-central-1';

function getCredentialsDir(): string {
  if (process.env.__TEST_CREDS_DIR) return process.env.__TEST_CREDS_DIR;
  const runId = process.env.GITHUB_RUN_ID ?? 'unknown';
  return path.join(os.tmpdir(), `.gh-action-cache-${runId}`);
}

export async function run(): Promise<void> {
  try {
    const environment = core.getInput('environment') || 'prod';

    const poolId = POOL_IDS[environment];
    const accountId = ACCOUNT_IDS[environment];
    if (!poolId || !accountId) {
      throw new Error(`Unknown environment: ${environment}. Use 'prod' or 'dev'.`);
    }

    const credentials = await getCognitoCredentials({
      poolId,
      accountId,
      region: AWS_REGION,
    });

    const credsDir = getCredentialsDir();
    await fs.mkdir(credsDir, { recursive: true, mode: 0o700 });
    const credsFile = path.join(credsDir, 'credentials.json');
    await fs.writeFile(
      credsFile,
      JSON.stringify({
        AccessKeyId: credentials.accessKeyId,
        SecretAccessKey: credentials.secretAccessKey,
        SessionToken: credentials.sessionToken,
        Expiration: credentials.expiration,
      }),
      { mode: 0o600 }
    );
    core.info(`Credentials written to ${credsFile}`);

    // Always set outputs — these are needed by downstream steps via step-level env:
    core.setOutput('credentials-file', credsFile);
    core.setOutput('AWS_ACCESS_KEY_ID', credentials.accessKeyId);
    core.setOutput('AWS_SECRET_ACCESS_KEY', credentials.secretAccessKey);
    core.setOutput('AWS_SESSION_TOKEN', credentials.sessionToken);

    core.info('AWS credentials configured successfully');
  } catch (error) {
    core.setFailed(`Credential setup failed: ${error instanceof Error ? error.message : error}`);
  }
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
