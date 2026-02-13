import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  saveState: vi.fn(),
  getState: vi.fn(),
  exportVariable: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  setFailed: vi.fn(),
  setSecret: vi.fn(),
}));

import * as core from '@actions/core';

describe('credential-guard-main', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('saves credentials file path to GITHUB_STATE', async () => {
    vi.mocked(core.getInput).mockReturnValue('/tmp/creds/credentials.json');

    const { run } = await import('../src/credential-guard-main');
    await run();

    expect(core.saveState).toHaveBeenCalledWith(
      'credentials-file',
      '/tmp/creds/credentials.json'
    );
  });

  it('fails when credentials-file input is missing', async () => {
    vi.mocked(core.getInput).mockImplementation(() => {
      throw new Error('Input required and not supplied: credentials-file');
    });

    const { run } = await import('../src/credential-guard-main');
    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('credentials-file')
    );
  });
});

describe('credential-guard-post', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guard-test-'));
  });

  afterEach(async () => {
    delete process.env.__TEST_AWS_HOME;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads credentials from file and exports to GITHUB_ENV', async () => {
    const credsFile = path.join(tmpDir, 'credentials.json');
    await fs.writeFile(
      credsFile,
      JSON.stringify({
        AccessKeyId: 'AKIA_RESTORED',
        SecretAccessKey: 'secret_restored',
        SessionToken: 'token_restored',
      })
    );

    vi.mocked(core.getState).mockReturnValue(credsFile);

    const { run } = await import('../src/credential-guard-post');
    await run();

    expect(core.exportVariable).toHaveBeenCalledWith('AWS_ACCESS_KEY_ID', 'AKIA_RESTORED');
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_SECRET_ACCESS_KEY', 'secret_restored');
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_SESSION_TOKEN', 'token_restored');
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_REGION', 'eu-central-1');
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_DEFAULT_REGION', 'eu-central-1');
    // Verify profile-based config is cleared so SDK uses fromEnv
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_PROFILE', '');
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_DEFAULT_PROFILE', '');
  });

  it('warns and continues if credentials file is missing', async () => {
    vi.mocked(core.getState).mockReturnValue('/nonexistent/credentials.json');

    const { run } = await import('../src/credential-guard-post');
    await run();

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('Failed to restore'));
    expect(core.exportVariable).not.toHaveBeenCalled();
  });

  it('warns if no state was saved', async () => {
    vi.mocked(core.getState).mockReturnValue('');

    const { run } = await import('../src/credential-guard-post');
    await run();

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('No credentials file'));
  });

  it('writes ~/.aws/credentials with correct INI format', async () => {
    const credsFile = path.join(tmpDir, 'credentials.json');
    await fs.writeFile(
      credsFile,
      JSON.stringify({
        AccessKeyId: 'AKIA_FALLBACK',
        SecretAccessKey: 'secret_fallback',
        SessionToken: 'token_fallback',
      })
    );

    const fakeAwsHome = path.join(tmpDir, 'fakehome');
    await fs.mkdir(fakeAwsHome, { recursive: true });
    process.env.__TEST_AWS_HOME = fakeAwsHome;

    vi.mocked(core.getState).mockReturnValue(credsFile);

    const { run } = await import('../src/credential-guard-post');
    await run();

    const awsCredentials = await fs.readFile(
      path.join(fakeAwsHome, '.aws', 'credentials'),
      'utf-8'
    );
    expect(awsCredentials).toContain('[default]');
    expect(awsCredentials).toContain('aws_access_key_id = AKIA_FALLBACK');
    expect(awsCredentials).toContain('aws_secret_access_key = secret_fallback');
    expect(awsCredentials).toContain('aws_session_token = token_fallback');

    // Verify directory permissions (0o700)
    const awsDirStat = await fs.stat(path.join(fakeAwsHome, '.aws'));
    expect(awsDirStat.mode & 0o777).toBe(0o700);

    // Verify file permissions (0o600)
    const credsStat = await fs.stat(path.join(fakeAwsHome, '.aws', 'credentials'));
    expect(credsStat.mode & 0o777).toBe(0o600);
  });

  it('writes ~/.aws/config with correct region', async () => {
    const credsFile = path.join(tmpDir, 'credentials.json');
    await fs.writeFile(
      credsFile,
      JSON.stringify({
        AccessKeyId: 'AKIA_FALLBACK',
        SecretAccessKey: 'secret_fallback',
        SessionToken: 'token_fallback',
      })
    );

    const fakeAwsHome = path.join(tmpDir, 'fakehome');
    await fs.mkdir(fakeAwsHome, { recursive: true });
    process.env.__TEST_AWS_HOME = fakeAwsHome;

    vi.mocked(core.getState).mockReturnValue(credsFile);

    const { run } = await import('../src/credential-guard-post');
    await run();

    const awsConfig = await fs.readFile(
      path.join(fakeAwsHome, '.aws', 'config'),
      'utf-8'
    );
    expect(awsConfig).toContain('[default]');
    expect(awsConfig).toContain('region = eu-central-1');

    // Verify file permissions (0o600)
    const configStat = await fs.stat(path.join(fakeAwsHome, '.aws', 'config'));
    expect(configStat.mode & 0o777).toBe(0o600);
  });

  it('logs fallback message after writing credentials file', async () => {
    const credsFile = path.join(tmpDir, 'credentials.json');
    await fs.writeFile(
      credsFile,
      JSON.stringify({
        AccessKeyId: 'AKIA_LOG',
        SecretAccessKey: 'secret_log',
        SessionToken: 'token_log',
      })
    );

    const fakeAwsHome = path.join(tmpDir, 'fakehome');
    await fs.mkdir(fakeAwsHome, { recursive: true });
    process.env.__TEST_AWS_HOME = fakeAwsHome;

    vi.mocked(core.getState).mockReturnValue(credsFile);

    const { run } = await import('../src/credential-guard-post');
    await run();

    expect(core.info).toHaveBeenCalledWith(
      'Wrote credentials to ~/.aws/credentials [default] profile (fallback for nested composites)'
    );
  });

  it('does not write ~/.aws/credentials when credentials are missing fields', async () => {
    const credsFile = path.join(tmpDir, 'credentials.json');
    await fs.writeFile(
      credsFile,
      JSON.stringify({
        AccessKeyId: 'AKIA_PARTIAL',
        SecretAccessKey: '',
        SessionToken: 'token_partial',
      })
    );

    const fakeAwsHome = path.join(tmpDir, 'fakehome');
    await fs.mkdir(fakeAwsHome, { recursive: true });
    process.env.__TEST_AWS_HOME = fakeAwsHome;

    vi.mocked(core.getState).mockReturnValue(credsFile);

    const { run } = await import('../src/credential-guard-post');
    await run();

    const awsDirExists = await fs.access(path.join(fakeAwsHome, '.aws')).then(() => true).catch(() => false);
    expect(awsDirExists).toBe(false);
  });
});
