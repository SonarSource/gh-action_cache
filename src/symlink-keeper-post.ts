import * as core from '@actions/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const CACHE_METRICS_WORKSPACE_LINK = path.join('.actions', 'cache-metrics');

/**
 * Recreate the `.actions/cache-metrics` symlink if a nested actions/checkout wiped it
 * between the parent composite's main steps and cache-metrics' post step. Runs before the
 * cache-metrics post step (LIFO ordering) so its `uses: ./.actions/cache-metrics`
 * resolves even after `git clean -ffdx` + `git reset --hard HEAD` +
 * `git checkout --force <ref>` from a nested actions/checkout in the same job.
 *
 * Best-effort: any failure here is logged but never fails the post step.
 */
export async function ensureCacheMetricsSymlink(target: string): Promise<void> {
  if (!target) return;

  try {
    await fs.access(path.join(CACHE_METRICS_WORKSPACE_LINK, 'action.yml'));
    return;
  } catch {
    // fall through to recreate
  }

  try {
    await fs.access(path.join(target, 'action.yml'));
  } catch (err) {
    core.warning(
      `cache-metrics symlink keeper: target action.yml missing under ${target} — skipping recreation: ${
        err instanceof Error ? err.message : err
      }`
    );
    return;
  }

  try {
    await fs.mkdir(path.dirname(CACHE_METRICS_WORKSPACE_LINK), { recursive: true });
    try {
      await fs.unlink(CACHE_METRICS_WORKSPACE_LINK);
    } catch {
      // either doesn't exist (ENOENT) or is a directory (EISDIR) — unlink fails silently;
      // symlink() will error with EEXIST in that case and the outer catch will log a warning.
    }
    await fs.symlink(target, CACHE_METRICS_WORKSPACE_LINK);
    core.info(`cache-metrics symlink keeper: recreated ${CACHE_METRICS_WORKSPACE_LINK} -> ${target}`);
  } catch (err) {
    core.warning(
      `cache-metrics symlink keeper: failed to recreate ${CACHE_METRICS_WORKSPACE_LINK}: ${
        err instanceof Error ? err.message : err
      }`
    );
  }
}

export async function run(): Promise<void> {
  await ensureCacheMetricsSymlink(core.getState('cache-metrics-action-path'));
}

/* istanbul ignore next */
if (!process.env.VITEST) {
  run();
}
