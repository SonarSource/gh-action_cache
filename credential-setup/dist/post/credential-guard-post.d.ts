export declare function getAwsDir(): string;
export declare function writeAwsCredentialsFile(creds: {
    AccessKeyId: string;
    SecretAccessKey: string;
    SessionToken: string;
}): Promise<void>;
export declare function run(): Promise<void>;
