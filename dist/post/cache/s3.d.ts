/**
 * S3 Cache Operations
 * Direct S3 implementation for cache storage and retrieval
 */
import { AwsCredentials, CacheRestoreResult } from '../types';
/**
 * Restore cache from S3
 */
export declare function restoreFromS3(options: {
    paths: string[];
    primaryKey: string;
    restoreKeys: string[];
    credentials: AwsCredentials;
    bucket: string;
    lookupOnly: boolean;
}): Promise<CacheRestoreResult>;
/**
 * Save cache to S3
 */
export declare function saveToS3(options: {
    paths: string[];
    key: string;
    credentials: AwsCredentials;
    bucket: string;
    uploadChunkSize?: number;
}): Promise<void>;
//# sourceMappingURL=s3.d.ts.map