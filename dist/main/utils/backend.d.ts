/**
 * Backend detection utilities
 */
export type CacheBackend = 'github' | 's3';
/**
 * Determine which cache backend to use
 * - If explicitly set via input, use that
 * - For public repos, use GitHub cache
 * - For private/internal repos, use S3 cache
 */
export declare function determineBackend(forcedBackend?: string): Promise<CacheBackend>;
//# sourceMappingURL=backend.d.ts.map