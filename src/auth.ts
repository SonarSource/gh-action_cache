import * as core from '@actions/core';
import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
} from '@aws-sdk/client-cognito-identity';
import { retryWithBackoff, RetryOptions } from './retry';

const IDENTITY_PROVIDER = 'token.actions.githubusercontent.com';
const AUDIENCE = 'cognito-identity.amazonaws.com';

const NON_RETRYABLE_AUTH_ERRORS = new Set([
  'ValidationException',
  'NotAuthorizedException',
  'ResourceNotFoundException',
  'InvalidIdentityPoolConfigurationException',
  'InvalidParameterException',
]);

function isRetryableAuthError(error: unknown): boolean {
  const name = error instanceof Error ? error.name : '';
  return !NON_RETRYABLE_AUTH_ERRORS.has(name);
}

async function fetchAndMaskOidcToken(): Promise<string> {
  const token = await core.getIDToken(AUDIENCE);
  core.setSecret(token);
  return token;
}

async function sendWithFreshOidcLogins<T>(
  send: (logins: Record<string, string>) => Promise<T>
): Promise<T> {
  const token = await fetchAndMaskOidcToken();
  return send({ [IDENTITY_PROVIDER]: token });
}

export interface AuthConfig {
  poolId: string;
  accountId: string;
  region: string;
  retryOptions?: Partial<Omit<RetryOptions, 'label'>>;
}

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: string;
}

export async function getCognitoCredentials(config: AuthConfig): Promise<AwsCredentials> {
  const retryOpts = { shouldRetry: isRetryableAuthError, ...config.retryOptions };

  core.info('Requesting GitHub OIDC token...');
  await retryWithBackoff(
    () => fetchAndMaskOidcToken(),
    { label: 'GitHub OIDC token', ...retryOpts }
  );

  const client = new CognitoIdentityClient({ region: config.region });

  core.info('Exchanging OIDC token for Cognito identity...');
  const { IdentityId } = await retryWithBackoff(
    () => sendWithFreshOidcLogins((logins) => client.send(new GetIdCommand({
      IdentityPoolId: config.poolId,
      AccountId: config.accountId,
      Logins: logins,
    }))),
    { label: 'Cognito GetId', ...retryOpts }
  );

  if (!IdentityId) {
    throw new Error('Failed to obtain Identity ID from Cognito Identity Pool');
  }

  core.info('Obtaining AWS credentials from Cognito...');
  const { Credentials } = await retryWithBackoff(
    () => sendWithFreshOidcLogins((logins) => client.send(new GetCredentialsForIdentityCommand({
      IdentityId,
      Logins: logins,
    }))),
    { label: 'Cognito GetCredentials', ...retryOpts }
  );

  if (!Credentials?.AccessKeyId || !Credentials?.SecretKey || !Credentials?.SessionToken) {
    throw new Error('Failed to obtain AWS credentials from Cognito');
  }

  core.setSecret(Credentials.AccessKeyId);
  core.setSecret(Credentials.SecretKey);
  core.setSecret(Credentials.SessionToken);

  return {
    accessKeyId: Credentials.AccessKeyId,
    secretAccessKey: Credentials.SecretKey,
    sessionToken: Credentials.SessionToken,
    expiration: Credentials.Expiration?.toISOString() ?? '',
  };
}
