/**
 * AWS Cognito Authentication
 * Exchanges GitHub OIDC token for AWS credentials
 */
import { AwsCredentials } from '../types';
/**
 * Authenticate to AWS using GitHub OIDC and Cognito Identity Pool
 */
export declare function authenticateAws(environment: 'prod' | 'dev'): Promise<AwsCredentials>;
//# sourceMappingURL=cognito.d.ts.map