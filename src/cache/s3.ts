/**
 * S3 Cache Operations
 * Direct S3 implementation for cache storage and retrieval
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import * as tar from 'tar';
import { AwsCredentials, CacheRestoreResult } from '../types';

/**
 * Create S3 client with credentials
 */
function createS3Client(credentials: AwsCredentials): S3Client {
  return new S3Client({
    region: credentials.region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  });
}

/**
 * Get S3 key for cache entry
 */
function getCacheS3Key(key: string): string {
  // Sanitize key for S3
  return `${key}.tar.gz`;
}

/**
 * Check if a cache entry exists
 */
async function cacheExists(
  client: S3Client,
  bucket: string,
  key: string
): Promise<boolean> {
  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: getCacheS3Key(key),
      })
    );
    return true;
  } catch (error: unknown) {
    const s3Error = error as { $metadata?: { httpStatusCode?: number } };
    if (s3Error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Find a matching cache entry using prefix matching
 */
async function findMatchingCache(
  client: S3Client,
  bucket: string,
  prefix: string
): Promise<string | null> {
  try {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 100,
      })
    );

    if (!response.Contents || response.Contents.length === 0) {
      return null;
    }

    // Sort by LastModified descending (most recent first)
    const sorted = response.Contents.sort((a, b) => {
      const timeA = a.LastModified?.getTime() || 0;
      const timeB = b.LastModified?.getTime() || 0;
      return timeB - timeA;
    });

    // Return the key without .tar.gz extension
    const matchedKey = sorted[0].Key;
    if (matchedKey?.endsWith('.tar.gz')) {
      return matchedKey.slice(0, -7);
    }
    return matchedKey || null;
  } catch (error) {
    core.debug(`Error listing cache entries: ${error}`);
    return null;
  }
}

/**
 * Restore cache from S3
 */
export async function restoreFromS3(options: {
  paths: string[];
  primaryKey: string;
  restoreKeys: string[];
  credentials: AwsCredentials;
  bucket: string;
  lookupOnly: boolean;
}): Promise<CacheRestoreResult> {
  const client = createS3Client(options.credentials);
  const allKeys = [options.primaryKey, ...options.restoreKeys];

  core.info(`Looking for cache with primary key: ${options.primaryKey}`);

  for (const key of allKeys) {
    // First try exact match
    const exactExists = await cacheExists(client, options.bucket, key);

    if (exactExists) {
      core.info(`Cache found: ${key}`);

      if (options.lookupOnly) {
        return {
          exactMatch: key === options.primaryKey,
          matchedKey: key,
        };
      }

      // Download and extract
      await downloadAndExtract(client, options.bucket, key, options.paths);

      return {
        exactMatch: key === options.primaryKey,
        matchedKey: key,
      };
    }

    // Try prefix match for restore keys
    if (key !== options.primaryKey) {
      const matchedKey = await findMatchingCache(client, options.bucket, key);
      if (matchedKey) {
        core.info(`Cache found with prefix match: ${matchedKey}`);

        if (options.lookupOnly) {
          return {
            exactMatch: false,
            matchedKey,
          };
        }

        await downloadAndExtract(client, options.bucket, matchedKey, options.paths);

        return {
          exactMatch: false,
          matchedKey,
        };
      }
    }
  }

  core.info('Cache not found');
  return {
    exactMatch: false,
    matchedKey: null,
  };
}

/**
 * Download cache from S3 and extract
 */
async function downloadAndExtract(
  client: S3Client,
  bucket: string,
  key: string,
  paths: string[]
): Promise<void> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-action-cache-'));
  const archivePath = path.join(tempDir, 'cache.tar.gz');

  try {
    core.info(`Downloading cache from S3...`);

    const response = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: getCacheS3Key(key),
      })
    );

    if (!response.Body) {
      throw new Error('Empty response from S3');
    }

    // Write stream to file
    const bodyStream = response.Body as NodeJS.ReadableStream;
    const writeStream = fs.createWriteStream(archivePath);

    await new Promise<void>((resolve, reject) => {
      bodyStream.pipe(writeStream);
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    core.info('Extracting cache...');

    // Extract to working directory
    await tar.extract({
      file: archivePath,
      cwd: process.cwd(),
    });

    core.info('Cache restored successfully');
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Save cache to S3
 */
export async function saveToS3(options: {
  paths: string[];
  key: string;
  credentials: AwsCredentials;
  bucket: string;
  uploadChunkSize?: number;
}): Promise<void> {
  const client = createS3Client(options.credentials);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-action-cache-'));
  const archivePath = path.join(tempDir, 'cache.tar.gz');

  try {
    // Check if cache already exists
    if (await cacheExists(client, options.bucket, options.key)) {
      core.info(`Cache already exists for key: ${options.key}`);
      return;
    }

    core.info(`Creating cache archive for paths: ${options.paths.join(', ')}`);

    // Resolve and validate paths
    const resolvedPaths = options.paths
      .map(p => {
        // Handle home directory expansion
        if (p.startsWith('~')) {
          return path.join(os.homedir(), p.slice(1));
        }
        return path.resolve(p);
      })
      .filter(p => {
        if (!fs.existsSync(p)) {
          core.warning(`Path does not exist, skipping: ${p}`);
          return false;
        }
        return true;
      });

    if (resolvedPaths.length === 0) {
      core.warning('No valid paths to cache');
      return;
    }

    // Create tar archive
    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: process.cwd(),
        portable: true,
      },
      resolvedPaths.map(p => path.relative(process.cwd(), p))
    );

    const stats = fs.statSync(archivePath);
    core.info(`Archive size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    core.info(`Uploading cache to S3...`);

    // Upload to S3
    const fileContent = fs.readFileSync(archivePath);

    await client.send(
      new PutObjectCommand({
        Bucket: options.bucket,
        Key: getCacheS3Key(options.key),
        Body: fileContent,
        ContentType: 'application/gzip',
      })
    );

    core.info(`Cache saved successfully: ${options.key}`);
  } finally {
    // Cleanup temp files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
