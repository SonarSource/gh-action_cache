/**
 * AWS Cognito Authentication
 * Exchanges GitHub OIDC token for AWS credentials
 */

import * as core from '@actions/core';
import {
  CognitoIdentityClient,
  GetIdCommand,
  GetCredentialsForIdentityCommand,
} from '@aws-sdk/client-cognito-identity';
import { getGitHubOidcToken } from './oidc';
import { AwsCredentials, CognitoConfig } from '../types';

const COGNITO_CONFIG: Record<'prod' | 'dev', CognitoConfig> = {
  prod: {
    poolId: 'eu-central-1:511fe374-ae4f-46d0-adb7-9246e570c7f4',
    accountId: '275878209202',
    region: 'eu-central-1',
  },
  dev: {
    poolId: 'eu-central-1:3221c6ea-3f67-4fd8-a7ff-7426f96add89',
    accountId: '460386131003',
    region: 'eu-central-1',
  },
};

const IDENTITY_PROVIDER = 'token.actions.githubusercontent.com';
const COGNITO_AUDIENCE = 'cognito-identity.amazonaws.com';

/**
 * Authenticate to AWS using GitHub OIDC and Cognito Identity Pool
 */
export async function authenticateAws(
  environment: 'prod' | 'dev'
): Promise<AwsCredentials> {
  const config = COGNITO_CONFIG[environment];

  core.info(`Authenticating to AWS Cognito (${environment} environment)...`);

  // Create Cognito client without credentials (we're using OIDC)
  const cognitoClient = new CognitoIdentityClient({
    region: config.region,
  });

  // Step 1: Get GitHub OIDC token
  core.debug('Requesting GitHub OIDC token...');
  const oidcToken = await getGitHubOidcToken(COGNITO_AUDIENCE);
  core.debug('OIDC token obtained successfully');

  // Step 2: Get Cognito Identity ID
  core.debug('Getting Cognito Identity ID...');
  const getIdResponse = await cognitoClient.send(
    new GetIdCommand({
      IdentityPoolId: config.poolId,
      AccountId: config.accountId,
      Logins: {
        [IDENTITY_PROVIDER]: oidcToken,
      },
    })
  );

  if (!getIdResponse.IdentityId) {
    throw new Error(
      'Failed to obtain Cognito Identity ID. ' +
      'Check identity pool configuration and IAM trust policy.'
    );
  }

  core.debug(`Identity ID: ${getIdResponse.IdentityId}`);

  // Step 3: Get AWS credentials
  core.debug('Getting AWS credentials from Cognito...');
  const getCredentialsResponse = await cognitoClient.send(
    new GetCredentialsForIdentityCommand({
      IdentityId: getIdResponse.IdentityId,
      Logins: {
        [IDENTITY_PROVIDER]: oidcToken,
      },
    })
  );

  const credentials = getCredentialsResponse.Credentials;
  if (
    !credentials?.AccessKeyId ||
    !credentials?.SecretKey ||
    !credentials?.SessionToken
  ) {
    throw new Error(
      'Failed to obtain AWS credentials from Cognito. ' +
      'Check IAM role configuration and permissions.'
    );
  }

  // Mask credentials in logs
  core.setSecret(credentials.AccessKeyId);
  core.setSecret(credentials.SecretKey);
  core.setSecret(credentials.SessionToken);

  core.info('AWS authentication successful');

  return {
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretKey,
    sessionToken: credentials.SessionToken,
    region: config.region,
  };
}
