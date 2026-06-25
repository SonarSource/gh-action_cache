import { fork } from 'child_process';
import * as path from 'path';

/**
 * Run runs-on/cache's prebuilt save-only bundle to upload the cache to S3, reusing the exact
 * artifact GitHub executes for `uses: runs-on/cache@<pinned SHA>`. We must NOT reimplement the
 * S3 upload — it is a runs-on patch of @actions/cache. The bundle reads INPUT_* from the
 * environment (NullStateProvider) and uses RUNS_ON_S3_BUCKET_CACHE + AWS creds already present
 * in the environment for the post step.
 */
export function runRunsOnSave(opts: {
  key: string;
  path: string;
  enableCrossOsArchive: boolean;
}): Promise<void> {
  // Resolved at runtime from the built post bundle (cache-save/dist/post/) up to cache-save/vendor/runs-on-save-only/index.js
  const bundle = path.join(__dirname, '..', '..', 'vendor', 'runs-on-save-only', 'index.js');
  return new Promise<void>((resolve, reject) => {
    const child = fork(bundle, [], {
      env: {
        ...process.env,
        INPUT_KEY: opts.key,
        INPUT_PATH: opts.path,
        INPUT_ENABLECROSSOSARCHIVE: String(opts.enableCrossOsArchive),
      },
    });
    // Settle exactly once: 'error' (e.g. spawn failure) can fire and then 'exit' may still fire.
    let settled = false;
    const done = (fn: () => void): void => {
      if (!settled) {
        settled = true;
        fn();
      }
    };
    child.on('error', (err) => done(() => reject(err)));
    child.on('exit', (code, signal) => {
      done(() => {
        if (code === 0) {
          resolve();
          return;
        }
        const detail = signal ? `signal ${signal}` : `exit code ${code}`;
        reject(new Error(`runs-on save failed with ${detail}`));
      });
    });
  });
}
