import * as core from '@actions/core';
import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
} from '@aws-sdk/client-cognito-identity';
import { retryWithBackoff, RetryOptions } from './retry';

const IDENTITY_PROVIDER = 'token.actions.githubusercontent.com';
const AUDIENCE = 'cognito-identity.amazonaws.com';

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
  const retryOpts = { ...config.retryOptions };

  core.info('Requesting GitHub OIDC token...');
  const oidcToken = await retryWithBackoff(
    () => core.getIDToken(AUDIENCE),
    { label: 'GitHub OIDC token', ...retryOpts }
  );
  core.setSecret(oidcToken);

  const client = new CognitoIdentityClient({ region: config.region });
  const logins = { [IDENTITY_PROVIDER]: oidcToken };

  core.info('Exchanging OIDC token for Cognito identity...');
  const { IdentityId } = await retryWithBackoff(
    () => client.send(new GetIdCommand({
      IdentityPoolId: config.poolId,
      AccountId: config.accountId,
      Logins: logins,
    })),
    { label: 'Cognito GetId', ...retryOpts }
  );

  if (!IdentityId) {
    throw new Error('Failed to obtain Identity ID from Cognito Identity Pool');
  }

  core.info('Obtaining AWS credentials from Cognito...');
  const { Credentials } = await retryWithBackoff(
    () => client.send(new GetCredentialsForIdentityCommand({
      IdentityId,
      Logins: logins,
    })),
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
