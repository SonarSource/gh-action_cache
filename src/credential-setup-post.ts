import * as core from '@actions/core';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

function getAwsDir(): string {
  return path.join(process.env.__TEST_AWS_HOME || os.homedir(), '.aws');
}

async function deleteFileIfExists(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch {
    // File doesn't exist, nothing to delete
  }
}

export async function run(): Promise<void> {
  const credentialsFile = core.getState('credentials-file');
  if (!credentialsFile) {
    core.info('No credentials file in state — skipping cleanup');
    return;
  }

  try {
    const awsDir = getAwsDir();
    const credentialsBackup = core.getState('aws-credentials-backup');
    const configBackup = core.getState('aws-config-backup');

    // Restore or delete ~/.aws/credentials
    const awsCredsPath = path.join(awsDir, 'credentials');
    if (credentialsBackup) {
      await fs.writeFile(awsCredsPath, credentialsBackup, { mode: 0o600 });
      core.info('Restored original ~/.aws/credentials from backup');
    } else {
      await deleteFileIfExists(awsCredsPath);
      core.info('Removed ~/.aws/credentials (no backup — file did not exist before)');
    }

    // Restore or delete ~/.aws/config
    const awsConfigPath = path.join(awsDir, 'config');
    if (configBackup) {
      await fs.writeFile(awsConfigPath, configBackup, { mode: 0o600 });
      core.info('Restored original ~/.aws/config from backup');
    } else {
      await deleteFileIfExists(awsConfigPath);
      core.info('Removed ~/.aws/config (no backup — file did not exist before)');
    }

    // Delete the temp credentials JSON file
    await deleteFileIfExists(credentialsFile);
    core.info(`Deleted temp credentials file: ${credentialsFile}`);

    core.info('Credential cleanup complete');
  } catch (error) {
    core.warning(`Credential cleanup failed: ${error instanceof Error ? error.message : error}`);
  }
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
