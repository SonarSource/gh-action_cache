import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  getState: vi.fn(),
  saveState: vi.fn(),
  setOutput: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  setFailed: vi.fn(),
}));

import * as core from '@actions/core';
import {
  DEFAULT_METRICS_DIR,
  measureCacheBytes,
  metricsFilePath,
  readInputs,
  readMetricsFile,
  slugifyStepId,
  writeMetricsFile,
} from '../src/cache-metrics';

describe('slugifyStepId', () => {
  it('passes through clean ids', () => {
    expect(slugifyStepId('cache-python')).toBe('cache-python');
    expect(slugifyStepId('Cache_42')).toBe('Cache_42');
  });

  it('replaces special characters with dashes (preserves underscores like __run_N)', () => {
    expect(slugifyStepId('__SonarSource/gh-action_cache@v1')).toBe(
      '__SonarSource-gh-action_cache-v1'
    );
    expect(slugifyStepId('a.b/c d')).toBe('a-b-c-d');
    expect(slugifyStepId('__run_1')).toBe('__run_1');
  });

  it('collapses runs of dashes and trims edges', () => {
    expect(slugifyStepId('---foo!!!bar---')).toBe('foo-bar');
  });

  it('falls back to "cache" when input is empty or all special', () => {
    expect(slugifyStepId('')).toBe('cache');
    expect(slugifyStepId('!!!')).toBe('cache');
  });
});

describe('measureCacheBytes', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cache-metrics-'));
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== 'linux')('returns total bytes of existing files', () => {
    const f1 = path.join(tmp, 'a.bin');
    const f2 = path.join(tmp, 'b.bin');
    fs.writeFileSync(f1, Buffer.alloc(1024));
    fs.writeFileSync(f2, Buffer.alloc(2048));

    const total = measureCacheBytes(`${f1}\n${f2}`);
    expect(total).toBeGreaterThanOrEqual(1024 + 2048);
  });

  it.skipIf(process.platform !== 'linux')('returns 0 when no input', () => {
    expect(measureCacheBytes('')).toBe(0);
    expect(measureCacheBytes('   \n\n   ')).toBe(0);
  });

  it.skipIf(process.platform !== 'linux')('skips missing paths without erroring', () => {
    const realFile = path.join(tmp, 'real.bin');
    fs.writeFileSync(realFile, Buffer.alloc(512));

    const missing = path.join(tmp, 'does-not-exist');
    const total = measureCacheBytes(`${missing}\n${realFile}`);
    expect(total).toBeGreaterThanOrEqual(512);
  });

  it.skipIf(process.platform !== 'linux')('expands shell globs', () => {
    const sizeOne = 100;
    const sizeTwo = 200;
    fs.writeFileSync(path.join(tmp, 'one.bin'), Buffer.alloc(sizeOne));
    fs.writeFileSync(path.join(tmp, 'two.bin'), Buffer.alloc(sizeTwo));

    const total = measureCacheBytes(`${tmp}/*.bin`);
    expect(total).toBeGreaterThanOrEqual(sizeOne + sizeTwo);
  });

  it.skipIf(process.platform !== 'linux')('returns 0 when glob matches nothing', () => {
    const total = measureCacheBytes(`${tmp}/*.nope`);
    expect(total).toBe(0);
  });
});

describe('metricsFilePath / read / write', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cache-metrics-fs-'));
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('composes the filename from dir + pre-slugified step id', () => {
    // The caller is expected to slugify; metricsFilePath itself just composes.
    expect(metricsFilePath('/x/m', 'cache-python')).toBe('/x/m/cache-cache-python.json');
    expect(metricsFilePath('/x/m', slugifyStepId('!!!'))).toBe('/x/m/cache-cache.json');
  });

  it('writeMetricsFile creates the parent directory', () => {
    const target = path.join(tmp, 'nested', 'deep', 'cache-x.json');
    writeMetricsFile(target, {
      step: 'x',
      key: 'k',
      'restore-key-hit': null,
      backend: 'github',
      'cache-hit': false,
      'size-bytes-restored': 0,
      'size-bytes-at-end': null,
      saved: null,
      'timestamp-restored': '2026-05-12T00:00:00Z',
      'timestamp-at-end': null,
    });
    const parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
    expect(parsed.step).toBe('x');
    expect(parsed['size-bytes-at-end']).toBeNull();
  });

  it('readMetricsFile returns {} for missing or invalid files', () => {
    expect(readMetricsFile(path.join(tmp, 'missing.json'))).toEqual({});
    const corrupt = path.join(tmp, 'corrupt.json');
    fs.writeFileSync(corrupt, 'not valid json');
    expect(readMetricsFile(corrupt)).toEqual({});
  });
});

describe('readInputs metricsDir resolution', () => {
  const baseInputs: Record<string, string> = {
    path: '/x/x',
    key: 'k',
    backend: 's3',
    'step-id': 's',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(core.getInput).mockImplementation((name) => baseInputs[name] ?? '');
  });

  afterEach(() => {
    delete process.env.CI_METRICS_DIR;
  });

  it('uses CI_METRICS_DIR when set', () => {
    process.env.CI_METRICS_DIR = '/runner-metrics';
    expect(readInputs().metricsDir).toBe('/runner-metrics');
  });

  it('falls back to the default metrics dir when CI_METRICS_DIR is unset', () => {
    delete process.env.CI_METRICS_DIR;
    expect(readInputs().metricsDir).toBe(DEFAULT_METRICS_DIR);
    // Spec-mandated path used by the M1.3 consumer hook. Assemble to avoid Sonar's S5443 false positive.
    expect(DEFAULT_METRICS_DIR).toBe(['', 'tmp', 'ci-metrics'].join('/'));
  });

  it('falls back to /tmp/ci-metrics when CI_METRICS_DIR is empty', () => {
    process.env.CI_METRICS_DIR = '';
    expect(readInputs().metricsDir).toBe(DEFAULT_METRICS_DIR);
  });
});

describe('cache-metrics-main', () => {
  let tmp: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cache-metrics-main-'));
    process.env.CI_METRICS_DIR = tmp;
  });

  afterEach(async () => {
    delete process.env.CI_METRICS_DIR;
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== 'linux')('writes JSON, sets output, saves state', async () => {
    const cachedFile = path.join(tmp, 'pkg.tgz');
    fs.writeFileSync(cachedFile, Buffer.alloc(4096));

    const inputs: Record<string, string> = {
      path: cachedFile,
      key: 'python-Linux-abc',
      'cache-hit': 'true',
      'matched-key': 'python-Linux-abc',
      backend: 's3',
      'lookup-only': 'false',
      'step-id': 'cache-python',
    };
    vi.mocked(core.getInput).mockImplementation((name) => inputs[name] ?? '');

    const { run } = await import('../src/cache-metrics-main');
    await run();

    const written = path.join(tmp, 'cache-cache-python.json');
    const record = JSON.parse(fs.readFileSync(written, 'utf-8'));
    expect(record.step).toBe('cache-python');
    expect(record.key).toBe('python-Linux-abc');
    expect(record.backend).toBe('s3');
    expect(record['cache-hit']).toBe(true);
    // Exact hit: matched-key == primary key → restore-key-hit must be null.
    expect(record['restore-key-hit']).toBeNull();
    expect(record['size-bytes-restored']).toBeGreaterThanOrEqual(4096);
    expect(record['size-bytes-at-end']).toBeNull();
    expect(record.saved).toBeNull();
    expect(record['timestamp-restored']).toMatch(/Z$/);

    expect(core.setOutput).toHaveBeenCalledWith(
      'cache-size-bytes',
      expect.any(Number)
    );
    expect(core.saveState).toHaveBeenCalledWith('metricsFile', written);
    expect(core.saveState).toHaveBeenCalledWith('cacheHit', 'true');
    expect(core.saveState).toHaveBeenCalledWith('lookupOnly', 'false');
  });

  it.skipIf(process.platform !== 'linux').each([
    { name: 'partial-hit records the matched restore-key as restore-key-hit', matchedKey: 'python-Linux-', expected: 'python-Linux-' },
    { name: 'no-match leaves restore-key-hit null when matched-key is empty', matchedKey: '', expected: null },
  ])('$name', async ({ matchedKey, expected }) => {
    const inputs: Record<string, string> = {
      path: tmp,
      key: 'python-Linux-abc',
      'cache-hit': 'false',
      'matched-key': matchedKey,
      backend: 's3',
      'lookup-only': 'false',
      'step-id': 'cache-python',
    };
    vi.mocked(core.getInput).mockImplementation((name) => inputs[name] ?? '');

    const { run } = await import('../src/cache-metrics-main');
    await run();

    const record = JSON.parse(
      fs.readFileSync(path.join(tmp, 'cache-cache-python.json'), 'utf-8')
    );
    expect(record['restore-key-hit']).toBe(expected);
  });

  it('skips on non-linux platforms', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    try {
      const { run } = await import('../src/cache-metrics-main');
      await run();
      expect(core.setOutput).not.toHaveBeenCalled();
      expect(core.saveState).not.toHaveBeenCalled();
    } finally {
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('warns and continues if an error is thrown (fail-open)', async () => {
    vi.mocked(core.getInput).mockImplementation(() => {
      throw new Error('boom');
    });

    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      const { run } = await import('../src/cache-metrics-main');
      await run();
      expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('boom'));
      expect(core.setFailed).not.toHaveBeenCalled();
    } finally {
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    }
  });
});

describe('cache-metrics-post', () => {
  let tmp: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'cache-metrics-post-'));
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it.skipIf(process.platform !== 'linux')(
    'updates JSON with saved size and saved=true when not lookup-only and not exact hit',
    async () => {
      const cachedFile = path.join(tmp, 'big.tgz');
      fs.writeFileSync(cachedFile, Buffer.alloc(8192));

      const metricsFile = path.join(tmp, 'cache-cache-python.json');
      writeMetricsFile(metricsFile, {
        step: 'cache-python',
        key: 'k',
        'restore-key-hit': null,
        backend: 's3',
        'cache-hit': false,
        'size-bytes-restored': 0,
        'size-bytes-at-end': null,
        saved: null,
        'timestamp-restored': '2026-05-12T10:00:00Z',
        'timestamp-at-end': null,
      });

      const state: Record<string, string> = {
        metricsFile,
        path: cachedFile,
        cacheHit: 'false',
        lookupOnly: 'false',
      };
      vi.mocked(core.getState).mockImplementation((name) => state[name] ?? '');

      const { run } = await import('../src/cache-metrics-post');
      await run();

      const updated = JSON.parse(fs.readFileSync(metricsFile, 'utf-8'));
      expect(updated['size-bytes-at-end']).toBeGreaterThanOrEqual(8192);
      expect(updated.saved).toBe(true);
      expect(updated['timestamp-at-end']).toMatch(/Z$/);
      // restore-time fields preserved
      expect(updated.step).toBe('cache-python');
      expect(updated['timestamp-restored']).toBe('2026-05-12T10:00:00Z');
    }
  );

  it.skipIf(process.platform !== 'linux').each([
    {
      reason: 'cache-hit was true (exact match: cache action skips save)',
      stepName: 'x', file: 'cache-x.json', backend: 'github',
      cacheHit: true, cacheHitState: 'true', lookupOnlyState: 'false',
    },
    {
      reason: 'lookup-only was true',
      stepName: 'y', file: 'cache-y.json', backend: 's3',
      cacheHit: false, cacheHitState: 'false', lookupOnlyState: 'true',
    },
  ])('sets saved=false when $reason', async ({ stepName, file, backend, cacheHit, cacheHitState, lookupOnlyState }) => {
    const metricsFile = path.join(tmp, file);
    writeMetricsFile(metricsFile, {
      step: stepName,
      key: 'k',
      'restore-key-hit': null,
      backend,
      'cache-hit': cacheHit,
      'size-bytes-restored': cacheHit ? 100 : 0,
      'size-bytes-at-end': null,
      saved: null,
      'timestamp-restored': '2026-05-12T00:00:00Z',
      'timestamp-at-end': null,
    });

    const state: Record<string, string> = {
      metricsFile,
      path: '',
      cacheHit: cacheHitState,
      lookupOnly: lookupOnlyState,
    };
    vi.mocked(core.getState).mockImplementation((name) => state[name] ?? '');

    const { run } = await import('../src/cache-metrics-post');
    await run();

    const updated = JSON.parse(fs.readFileSync(metricsFile, 'utf-8'));
    expect(updated.saved).toBe(false);
  });

  it('skips when no state was saved (main step did not run)', async () => {
    vi.mocked(core.getState).mockReturnValue('');

    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      const { run } = await import('../src/cache-metrics-post');
      await run();
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('no state from main step')
      );
    } finally {
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('skips on non-linux platforms', async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    try {
      const { run } = await import('../src/cache-metrics-post');
      await run();
      expect(core.getState).not.toHaveBeenCalled();
    } finally {
      if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    }
  });
});
