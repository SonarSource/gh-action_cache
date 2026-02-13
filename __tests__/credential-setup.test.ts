import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  setOutput: vi.fn(),
  exportVariable: vi.fn(),
  setFailed: vi.fn(),
  info: vi.fn(),
  getIDToken: vi.fn(),
  setSecret: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@aws-sdk/client-cognito-identity', () => {
  const sendMock = vi.fn();
  return {
    CognitoIdentityClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
    GetIdCommand: vi.fn().mockImplementation((input) => input),
    GetCredentialsForIdentityCommand: vi.fn().mockImplementation((input) => input),
    __sendMock: sendMock,
  };
});

import * as core from '@actions/core';
import { __sendMock as sendMock } from '@aws-sdk/client-cognito-identity';

describe('credential-setup', () => {
  const originalEnv = process.env;
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...originalEnv, GITHUB_RUN_ID: '12345' };
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cred-test-'));
    process.env.__TEST_CREDS_DIR = tmpDir;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes credentials to file and exports env vars', async () => {
    // Ensure no pre-existing AWS credentials
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_PROFILE;

    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === 'environment') return 'prod';
      return '';
    });
    vi.mocked(core.getIDToken).mockResolvedValue('oidc-token');
    sendMock
      .mockResolvedValueOnce({ IdentityId: 'id-123' })
      .mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'AKIA_TEST',
          SecretKey: 'secret_test',
          SessionToken: 'token_test',
          Expiration: new Date('2026-01-01'),
        },
      });

    const { run } = await import('../src/credential-setup');
    await run();

    expect(core.setOutput).toHaveBeenCalledWith(
      'credentials-file',
      expect.stringContaining('credentials.json')
    );
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_ACCESS_KEY_ID', 'AKIA_TEST');
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_SECRET_ACCESS_KEY', 'secret_test');
    expect(core.exportVariable).toHaveBeenCalledWith('AWS_SESSION_TOKEN', 'token_test');
    expect(core.setOutput).toHaveBeenCalledWith('AWS_ACCESS_KEY_ID', 'AKIA_TEST');
    expect(core.setOutput).toHaveBeenCalledWith('AWS_SECRET_ACCESS_KEY', 'secret_test');
    expect(core.setOutput).toHaveBeenCalledWith('AWS_SESSION_TOKEN', 'token_test');
  });

  it('warns and skips env export when AWS credentials already exist', async () => {
    process.env.AWS_ACCESS_KEY_ID = 'EXISTING_KEY';
    process.env.AWS_SECRET_ACCESS_KEY = 'EXISTING_SECRET';

    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === 'environment') return 'prod';
      return '';
    });
    vi.mocked(core.getIDToken).mockResolvedValue('oidc-token');
    sendMock
      .mockResolvedValueOnce({ IdentityId: 'id-123' })
      .mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'AKIA_TEST',
          SecretKey: 'secret_test',
          SessionToken: 'token_test',
          Expiration: new Date('2026-01-01'),
        },
      });

    const { run } = await import('../src/credential-setup');
    await run();

    // Outputs should still be set
    expect(core.setOutput).toHaveBeenCalledWith(
      'credentials-file',
      expect.stringContaining('credentials.json')
    );
    expect(core.setOutput).toHaveBeenCalledWith('AWS_ACCESS_KEY_ID', 'AKIA_TEST');
    expect(core.setOutput).toHaveBeenCalledWith('AWS_SECRET_ACCESS_KEY', 'secret_test');
    expect(core.setOutput).toHaveBeenCalledWith('AWS_SESSION_TOKEN', 'token_test');

    // exportVariable should NOT be called for AWS credential vars
    expect(core.exportVariable).not.toHaveBeenCalledWith('AWS_ACCESS_KEY_ID', expect.anything());
    expect(core.exportVariable).not.toHaveBeenCalledWith('AWS_SECRET_ACCESS_KEY', expect.anything());
    expect(core.exportVariable).not.toHaveBeenCalledWith('AWS_SESSION_TOKEN', expect.anything());
    expect(core.exportVariable).not.toHaveBeenCalledWith('AWS_REGION', expect.anything());
    expect(core.exportVariable).not.toHaveBeenCalledWith('AWS_DEFAULT_REGION', expect.anything());

    // warning should be called
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('AWS credentials already configured')
    );
  });

  it('warns and skips env export when AWS_PROFILE is set', async () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    process.env.AWS_PROFILE = 'my-profile';

    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === 'environment') return 'prod';
      return '';
    });
    vi.mocked(core.getIDToken).mockResolvedValue('oidc-token');
    sendMock
      .mockResolvedValueOnce({ IdentityId: 'id-123' })
      .mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'AKIA_TEST',
          SecretKey: 'secret_test',
          SessionToken: 'token_test',
          Expiration: new Date('2026-01-01'),
        },
      });

    const { run } = await import('../src/credential-setup');
    await run();

    // Outputs should still be set
    expect(core.setOutput).toHaveBeenCalledWith(
      'credentials-file',
      expect.stringContaining('credentials.json')
    );
    expect(core.setOutput).toHaveBeenCalledWith('AWS_ACCESS_KEY_ID', 'AKIA_TEST');
    expect(core.setOutput).toHaveBeenCalledWith('AWS_SECRET_ACCESS_KEY', 'secret_test');
    expect(core.setOutput).toHaveBeenCalledWith('AWS_SESSION_TOKEN', 'token_test');

    // exportVariable should NOT be called for AWS credential vars
    expect(core.exportVariable).not.toHaveBeenCalledWith('AWS_ACCESS_KEY_ID', expect.anything());
    expect(core.exportVariable).not.toHaveBeenCalledWith('AWS_SECRET_ACCESS_KEY', expect.anything());
    expect(core.exportVariable).not.toHaveBeenCalledWith('AWS_SESSION_TOKEN', expect.anything());
    expect(core.exportVariable).not.toHaveBeenCalledWith('AWS_REGION', expect.anything());
    expect(core.exportVariable).not.toHaveBeenCalledWith('AWS_DEFAULT_REGION', expect.anything());

    // warning should be called
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('AWS credentials already configured')
    );
  });

  it('fails for unknown environment', async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === 'environment') return 'staging';
      return '';
    });

    const { run } = await import('../src/credential-setup');
    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Unknown environment')
    );
  });

  it('fails when Cognito auth throws', async () => {
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === 'environment') return 'prod';
      return '';
    });
    vi.mocked(core.getIDToken).mockRejectedValue(new Error('OIDC unavailable'));

    const { run } = await import('../src/credential-setup');
    await run();

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('OIDC unavailable')
    );
  });
});
