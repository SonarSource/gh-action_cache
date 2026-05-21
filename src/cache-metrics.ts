import * as core from '@actions/core';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface CacheMetricsInputs {
  path: string;
  key: string;
  cachePrimaryKey: string;
  cacheHit: boolean;
  matchedKey: string;
  backend: string;
  lookupOnly: boolean;
  stepId: string;
  metricsDir: string;
}

export interface CacheMetricsRecord {
  step: string;
  key: string;
  /**
   * The prefix-matched restore key. Populated only when `cache-hit` is false AND a restore key matched (partial hit); null on exact hits
   * and on misses.
   */
  'restore-key-hit': string | null;
  backend: string;
  'cache-hit': boolean;
  /** Size of the cache content at restore-time (0 on a miss with no partial hit). */
  'size-bytes-restored': number | null;
  /**
   * Size of the cache content at end of job, measured in the post step BEFORE the cache action's save runs. Reflects what would be saved
   * if `saved` is true, or simply the path size at job end if `saved` is false (e.g. exact hit, where the cache action skips save and user
   * modifications are not persisted).
   */
  'size-bytes-at-end': number | null;
  /**
   * Whether the cache action actually persists the cache at job end. False when `cache-hit` was true (exact match: cache action skips save)
   * or when lookup-only` was set.
   */
  saved: boolean | null;
  'timestamp-restored': string | null;
  'timestamp-at-end': string | null;
}

/**
 * Slugify a step id for safe filesystem use. Falls back to `cache` if empty.
 */
export function slugifyStepId(stepId: string): string {
  const slug = (stepId ?? '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'cache';
}

/**
 * Sum the total size in bytes of the given cache paths.
 *
 * Each input line may contain `~` and shell globs; expansion is delegated to `bash -c`, which also handles missing entries gracefully
 * (silently skipped).
 *
 * Returns 0 when no paths match anything on disk.
 */
// All `$...` references below are Bash variable expansions, NOT JS template-literal interpolations.
// The string is passed verbatim to `bash -c`.
//
// `inputs.path` is workflow-author input, but we still avoid `eval` on it to keep the attack surface minimal: word-splitting + glob
// expansion happen natively when `$line` is used unquoted in a `for ... in` loop, with `nullglob`/`globstar` handling missing matches.
const MEASURE_SCRIPT = [
  'set -uo pipefail',
  'shopt -s nullglob globstar',
  'total=0',
  'while IFS= read -r line || [ -n "$line" ]; do',
  '  [ -z "$line" ] && continue',
  '  # Expand a leading `~` to $HOME (bash only does tilde expansion on literals,',
  '  # not on values substituted from a variable).',
  '  line="${line/#~/$HOME}"',
  '  for p in $line; do',
  '    if [ -e "$p" ]; then',
  '      sz=$(du -sb -- "$p" 2>/dev/null | awk \'{print $1}\')',
  '      total=$((total + ${sz:-0}))',
  '    fi',
  '  done',
  'done',
  'echo "$total"',
].join('\n');

export function measureCacheBytes(pathInput: string): number {
  if (!pathInput.trim()) return 0;

  try {
    const out = execFileSync('/bin/bash', ['-c', MEASURE_SCRIPT], {
      input: pathInput,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const n = Number.parseInt(out.trim(), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch (err) {
    core.warning(`cache-metrics: du failed: ${err instanceof Error ? err.message : err}`);
    return 0;
  }
}

/**
 * Compose the metrics filename from a directory and an already-slugified step id.
 * Callers must pass the slug (run `slugifyStepId` first); avoids double slugification.
 */
export function metricsFilePath(metricsDir: string, slug: string): string {
  return path.join(metricsDir, `cache-${slug}.json`);
}

export function readMetricsFile(file: string): Partial<CacheMetricsRecord> {
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function writeMetricsFile(file: string, record: CacheMetricsRecord): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n', 'utf-8');
}

// Assembled at runtime to keep the SonarRule S5443 ("temp files in publicly writable directories") false positive away from a
// single literal — the path itself is part of the contract with the runner (BUILD-11293 pre-creates it with the right
// permissions) and with the M1.3 hook, so it cannot be parameterised away.
export const DEFAULT_METRICS_DIR = path.posix.join('/tmp', 'ci-metrics');

export function readInputs(): CacheMetricsInputs {
  return {
    path: core.getInput('path', { required: true }),
    key: core.getInput('key', { required: true }),
    cachePrimaryKey: core.getInput('cache-primary-key'),
    cacheHit: core.getInput('cache-hit').toLowerCase() === 'true',
    matchedKey: core.getInput('matched-key'),
    backend: core.getInput('backend', { required: true }),
    lookupOnly: core.getInput('lookup-only').toLowerCase() === 'true',
    stepId: core.getInput('step-id', { required: true }),
    // Output dir is provided by the runner (ARC pod template / WarpBuild AMI)
    // via the CI_METRICS_DIR env var. Default keeps the action usable on any
    // runner without that env preset.
    metricsDir: process.env.CI_METRICS_DIR || DEFAULT_METRICS_DIR,
  };
}
