import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({
  getIDToken: vi.fn(),
  info: vi.fn(),
  setSecret: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('@aws-sdk/client-cognito-identity', () => {
  const sendMock = vi.fn();
  return {
    CognitoIdentityClient: vi.fn().mockImplementation(() => ({ send: sendMock })),
    GetIdCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'GetId' })),
    GetCredentialsForIdentityCommand: vi.fn().mockImplementation((input) => ({ input, _type: 'GetCreds' })),
    __sendMock: sendMock,
  };
});

import * as core from '@actions/core';
import { __sendMock as sendMock } from '@aws-sdk/client-cognito-identity';
import { getCognitoCredentials } from '../src/auth';
import { DEFAULT_MAX_ATTEMPTS } from '../src/retry';

const fastRetry = { retryOptions: { baseDelayMs: 1 } };

describe('getCognitoCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exchanges OIDC token for Cognito credentials', async () => {
    const mockToken = 'oidc-token-123';
    vi.mocked(core.getIDToken).mockResolvedValue(mockToken);

    sendMock
      .mockResolvedValueOnce({ IdentityId: 'eu-central-1:identity-abc' })
      .mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'AKIATEST',
          SecretKey: 'secret123',
          SessionToken: 'token456',
          Expiration: new Date('2026-01-01T00:00:00Z'),
        },
      });

    const result = await getCognitoCredentials({
      poolId: 'eu-central-1:pool-123',
      accountId: '123456789',
      region: 'eu-central-1',
    });

    expect(result.accessKeyId).toBe('AKIATEST');
    expect(result.secretAccessKey).toBe('secret123');
    expect(result.sessionToken).toBe('token456');
    expect(core.setSecret).toHaveBeenCalledWith('oidc-token-123');
    expect(core.setSecret).toHaveBeenCalledWith('AKIATEST');
    expect(core.setSecret).toHaveBeenCalledWith('secret123');
    expect(core.setSecret).toHaveBeenCalledWith('token456');
    expect(result.expiration).toBe('2026-01-01T00:00:00.000Z');
  });

  it('throws if identity ID is empty', async () => {
    vi.mocked(core.getIDToken).mockResolvedValue('token');
    sendMock.mockResolvedValueOnce({ IdentityId: null });

    await expect(
      getCognitoCredentials({ poolId: 'pool', accountId: '123', region: 'eu-central-1' })
    ).rejects.toThrow('Failed to obtain Identity ID');
  });

  it('throws if credentials are empty', async () => {
    vi.mocked(core.getIDToken).mockResolvedValue('token');
    sendMock
      .mockResolvedValueOnce({ IdentityId: 'id-123' })
      .mockResolvedValueOnce({ Credentials: { AccessKeyId: null } });

    await expect(
      getCognitoCredentials({ poolId: 'pool', accountId: '123', region: 'eu-central-1' })
    ).rejects.toThrow('Failed to obtain AWS credentials');
  });

  it('retries on transient OIDC token failure', async () => {
    vi.mocked(core.getIDToken)
      .mockRejectedValueOnce(new Error('OIDC timeout'))
      .mockResolvedValueOnce('oidc-token-retry');

    sendMock
      .mockResolvedValueOnce({ IdentityId: 'eu-central-1:identity-abc' })
      .mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'AKIARETRY',
          SecretKey: 'secret-retry',
          SessionToken: 'token-retry',
          Expiration: new Date('2026-01-01T00:00:00Z'),
        },
      });

    const result = await getCognitoCredentials({
      poolId: 'eu-central-1:pool-123',
      accountId: '123456789',
      region: 'eu-central-1',
      ...fastRetry,
    });

    expect(result.accessKeyId).toBe('AKIARETRY');
    expect(core.getIDToken).toHaveBeenCalledTimes(2);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining(`GitHub OIDC token failed (attempt 1/${DEFAULT_MAX_ATTEMPTS})`)
    );
  });

  it('retries on transient Cognito GetId failure', async () => {
    vi.mocked(core.getIDToken).mockResolvedValue('token');

    sendMock
      .mockRejectedValueOnce(new Error('Cognito throttle'))
      .mockResolvedValueOnce({ IdentityId: 'id-recovered' })
      .mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'AKIA2',
          SecretKey: 'secret2',
          SessionToken: 'token2',
          Expiration: new Date('2026-01-01T00:00:00Z'),
        },
      });

    const result = await getCognitoCredentials({
      poolId: 'pool',
      accountId: '123',
      region: 'eu-central-1',
      ...fastRetry,
    });

    expect(result.accessKeyId).toBe('AKIA2');
    // 1 fail + 1 GetId success + 1 GetCreds success
    expect(sendMock).toHaveBeenCalledTimes(DEFAULT_MAX_ATTEMPTS);
  });

  it('retries on transient Cognito GetCredentials failure', async () => {
    vi.mocked(core.getIDToken).mockResolvedValue('token');

    sendMock
      .mockResolvedValueOnce({ IdentityId: 'id-123' })
      .mockRejectedValueOnce(new Error('Cognito 500'))
      .mockResolvedValueOnce({
        Credentials: {
          AccessKeyId: 'AKIA3',
          SecretKey: 'secret3',
          SessionToken: 'token3',
          Expiration: new Date('2026-01-01T00:00:00Z'),
        },
      });

    const result = await getCognitoCredentials({
      poolId: 'pool',
      accountId: '123',
      region: 'eu-central-1',
      ...fastRetry,
    });

    expect(result.accessKeyId).toBe('AKIA3');
    // 1 GetId + 1 GetCreds fail + 1 GetCreds success
    expect(sendMock).toHaveBeenCalledTimes(DEFAULT_MAX_ATTEMPTS);
  });

  it('throws after all OIDC retries exhausted', async () => {
    vi.mocked(core.getIDToken).mockRejectedValue(new Error('OIDC down'));

    await expect(
      getCognitoCredentials({ poolId: 'pool', accountId: '123', region: 'eu-central-1', ...fastRetry })
    ).rejects.toThrow('OIDC down');

    expect(core.getIDToken).toHaveBeenCalledTimes(DEFAULT_MAX_ATTEMPTS);
  });
});
