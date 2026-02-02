/**
 * TypeScript interfaces for gh-action_cache
 */
export interface CacheInputs {
    path: string;
    key: string;
    restoreKeys?: string;
    uploadChunkSize?: number;
    enableCrossOsArchive: boolean;
    failOnCacheMiss: boolean;
    lookupOnly: boolean;
    environment: 'prod' | 'dev';
    fallbackBranch?: string;
    backend?: 'github' | 's3';
}
export interface AwsCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    region: string;
}
export interface CognitoConfig {
    poolId: string;
    accountId: string;
    region: string;
}
export interface PreparedKeys {
    branchKey: string;
    restoreKeys: string[];
}
export interface CacheRestoreResult {
    exactMatch: boolean;
    matchedKey: string | null;
}
export interface CacheSaveResult {
    success: boolean;
    key: string;
}
