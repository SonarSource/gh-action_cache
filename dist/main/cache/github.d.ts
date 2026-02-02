/**
 * GitHub Actions Cache wrapper
 * Uses @actions/cache for public repositories
 */
import { CacheRestoreResult } from '../types';
/**
 * Restore cache using GitHub Actions cache
 */
export declare function restoreFromGitHub(options: {
    paths: string[];
    primaryKey: string;
    restoreKeys: string[];
    lookupOnly: boolean;
    enableCrossOsArchive: boolean;
    failOnCacheMiss: boolean;
}): Promise<CacheRestoreResult>;
/**
 * Save cache using GitHub Actions cache
 */
export declare function saveToGitHub(options: {
    paths: string[];
    key: string;
    uploadChunkSize?: number;
    enableCrossOsArchive: boolean;
}): Promise<void>;
//# sourceMappingURL=github.d.ts.map