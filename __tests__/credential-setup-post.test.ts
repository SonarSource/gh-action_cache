import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

vi.mock('@actions/core', () => ({
  getState: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  setSecret: vi.fn(),
}));

import * as core from '@actions/core';

describe('credential-setup-post', () => {
  const originalEnv = process.env;
  let tmpDir: string;
  let awsDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...originalEnv };
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cred-post-test-'));
    process.env.__TEST_AWS_HOME = tmpDir;
    awsDir = path.join(tmpDir, '.aws');
    await fs.mkdir(awsDir, { recursive: true });
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('restores backed-up ~/.aws/credentials and config when backups exist', async () => {
    // Write files that credential-guard-post would have created
    await fs.writeFile(path.join(awsDir, 'credentials'), '[default]\naws_access_key_id = GUARD_KEY\n');
    await fs.writeFile(path.join(awsDir, 'config'), '[default]\nregion = eu-central-1\n');

    // Create a temp credentials file to be cleaned up
    const credsFile = path.join(tmpDir, 'credentials.json');
    await fs.writeFile(credsFile, '{}');

    vi.mocked(core.getState).mockImplementation((name: string) => {
      if (name === 'credentials-file') return credsFile;
      if (name === 'aws-credentials-backup') return '[default]\naws_access_key_id = ORIGINAL_KEY\n';
      if (name === 'aws-config-backup') return '[default]\nregion = us-west-2\n';
      return '';
    });

    const { run } = await import('../src/credential-setup-post');
    await run();

    // Verify credentials file was restored from backup
    const restoredCreds = await fs.readFile(path.join(awsDir, 'credentials'), 'utf-8');
    expect(restoredCreds).toBe('[default]\naws_access_key_id = ORIGINAL_KEY\n');

    // Verify config file was restored from backup
    const restoredConfig = await fs.readFile(path.join(awsDir, 'config'), 'utf-8');
    expect(restoredConfig).toBe('[default]\nregion = us-west-2\n');

    expect(core.info).toHaveBeenCalledWith('Restored original ~/.aws/credentials from backup');
    expect(core.info).toHaveBeenCalledWith('Restored original ~/.aws/config from backup');
    expect(core.info).toHaveBeenCalledWith('Credential cleanup complete');
  });

  it('deletes ~/.aws/credentials and config when no backup existed', async () => {
    // Write files that credential-guard-post would have created
    await fs.writeFile(path.join(awsDir, 'credentials'), '[default]\naws_access_key_id = GUARD_KEY\n');
    await fs.writeFile(path.join(awsDir, 'config'), '[default]\nregion = eu-central-1\n');

    const credsFile = path.join(tmpDir, 'credentials.json');
    await fs.writeFile(credsFile, '{}');

    vi.mocked(core.getState).mockImplementation((name: string) => {
      if (name === 'credentials-file') return credsFile;
      // Empty string = no backup existed before
      if (name === 'aws-credentials-backup') return '';
      if (name === 'aws-config-backup') return '';
      return '';
    });

    const { run } = await import('../src/credential-setup-post');
    await run();

    // Verify credentials file was deleted
    await expect(fs.access(path.join(awsDir, 'credentials'))).rejects.toThrow();
    // Verify config file was deleted
    await expect(fs.access(path.join(awsDir, 'config'))).rejects.toThrow();

    expect(core.info).toHaveBeenCalledWith(
      'Removed ~/.aws/credentials (no backup — file did not exist before)'
    );
    expect(core.info).toHaveBeenCalledWith(
      'Removed ~/.aws/config (no backup — file did not exist before)'
    );
  });

  it('deletes the temp credentials JSON file', async () => {
    const credsFile = path.join(tmpDir, 'credentials.json');
    await fs.writeFile(credsFile, '{"AccessKeyId":"test"}');

    vi.mocked(core.getState).mockImplementation((name: string) => {
      if (name === 'credentials-file') return credsFile;
      return '';
    });

    const { run } = await import('../src/credential-setup-post');
    await run();

    // Verify temp credentials file was deleted
    await expect(fs.access(credsFile)).rejects.toThrow();
    expect(core.info).toHaveBeenCalledWith(`Deleted temp credentials file: ${credsFile}`);
  });

  it('skips cleanup if no credentials-file in state', async () => {
    vi.mocked(core.getState).mockReturnValue('');

    const { run } = await import('../src/credential-setup-post');
    await run();

    expect(core.info).toHaveBeenCalledWith('No credentials file in state — skipping cleanup');
    expect(core.warning).not.toHaveBeenCalled();
  });

  it('continues on cleanup errors without failing', async () => {
    // Point credentials-file to a valid path but make the aws dir read-only to trigger errors
    const credsFile = path.join(tmpDir, 'credentials.json');

    vi.mocked(core.getState).mockImplementation((name: string) => {
      if (name === 'credentials-file') return credsFile;
      if (name === 'aws-credentials-backup') return 'backup-content';
      return '';
    });

    // Remove the .aws dir and make tmpDir read-only so writeFile fails
    await fs.rm(awsDir, { recursive: true, force: true });
    // Create a file where .aws directory should be, so mkdir fails
    await fs.writeFile(path.join(tmpDir, '.aws'), 'not-a-directory');
    // Make it read-only to prevent overwrite
    await fs.chmod(path.join(tmpDir, '.aws'), 0o444);

    const { run } = await import('../src/credential-setup-post');
    await run();

    // Should warn, not fail
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('Credential cleanup failed:')
    );
  });
});
