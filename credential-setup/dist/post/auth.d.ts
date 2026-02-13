export interface AuthConfig {
    poolId: string;
    accountId: string;
    region: string;
}
export interface AwsCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: string;
}
export declare function getCognitoCredentials(config: AuthConfig): Promise<AwsCredentials>;
