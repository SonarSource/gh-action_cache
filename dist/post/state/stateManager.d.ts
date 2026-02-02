/**
 * State Manager for passing data between main and post steps
 * Uses GITHUB_STATE which is invisible to user steps
 */
export declare const STATE_KEYS: {
    readonly BACKEND: "backend";
    readonly PATH: "cachePath";
    readonly PRIMARY_KEY: "primaryKey";
    readonly BRANCH_KEY: "branchKey";
    readonly CACHE_HIT: "cacheHit";
    readonly MATCHED_KEY: "matchedKey";
    readonly AWS_ACCESS_KEY_ID: "awsAccessKeyId";
    readonly AWS_SECRET_ACCESS_KEY: "awsSecretAccessKey";
    readonly AWS_SESSION_TOKEN: "awsSessionToken";
    readonly AWS_REGION: "awsRegion";
    readonly S3_BUCKET: "s3Bucket";
    readonly UPLOAD_CHUNK_SIZE: "uploadChunkSize";
    readonly ENABLE_CROSS_OS_ARCHIVE: "enableCrossOsArchive";
};
export type StateKey = typeof STATE_KEYS[keyof typeof STATE_KEYS];
/**
 * Save a value to GITHUB_STATE
 * This value will be available in the post step via STATE_<key> env var
 */
export declare function saveState(key: StateKey, value: string): void;
/**
 * Get a value from GITHUB_STATE (available in post step)
 * In post step, this reads from STATE_<key> env var
 */
export declare function getState(key: StateKey): string;
/**
 * Save all AWS credentials to state
 */
export declare function saveAwsCredentials(credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    region: string;
}): void;
/**
 * Retrieve AWS credentials from state (in post step)
 */
export declare function getAwsCredentials(): {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    region: string;
} | null;
//# sourceMappingURL=stateManager.d.ts.map