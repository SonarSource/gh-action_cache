import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({
  getIDToken: vi.fn(),
  info: vi.fn(),
  setSecret: vi.fn(),
  error: vi.fn(),
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
});
