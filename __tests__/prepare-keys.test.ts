import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCRIPT = path.join(__dirname, '..', 'scripts', 'prepare-keys.sh');

function runScript(env: Record<string, string>): Record<string, string> {
  const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pk-')), 'out');
  fs.writeFileSync(outFile, '');
  execFileSync('bash', [SCRIPT], {
    env: {
      ...process.env,
      GITHUB_OUTPUT: outFile,
      GITHUB_TOKEN: 'x',
      GITHUB_REPOSITORY: 'o/r',
      INPUT_FALLBACK_BRANCH: 'master', // avoid the GitHub API call
      ...env,
    },
  });
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(outFile, 'utf-8').split('\n')) {
    const m = line.match(/^([a-z-]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

describe('prepare-keys.sh', () => {
  it('emits fallback-exact-key when on a feature branch with a fallback branch', () => {
    const out = runScript({
      INPUT_KEY: 'gradle-abc123',
      GITHUB_REF: 'refs/heads/feature/x',
    });
    expect(out['fallback-exact-key']).toBe('refs/heads/master/gradle-abc123');
    expect(out['branch-key']).toBe('refs/heads/feature/x/gradle-abc123');
  });

  it('emits empty fallback-exact-key when already on the fallback branch', () => {
    const out = runScript({
      INPUT_KEY: 'gradle-abc123',
      GITHUB_REF: 'refs/heads/master',
    });
    expect(out['fallback-exact-key'] ?? '').toBe('');
  });
});
