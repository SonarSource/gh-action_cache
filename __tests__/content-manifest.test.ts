import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeStat {
  size: number;
  dir?: boolean;
}

const { createGlob, lstat, fileStats } = vi.hoisted(() => {
  // Maps absolute file path -> stat. Tests populate this per case.
  const fileStats: Record<string, { size: number; dir?: boolean }> = {};
  const lstat = vi.fn(async (f: string) => {
    const s = fileStats[f];
    if (!s) throw new Error(`ENOENT ${f}`);
    return { size: s.size, isDirectory: () => !!s.dir };
  });
  // createGlob is reset per test to control matched files + search paths.
  const createGlob = vi.fn();
  return { createGlob, lstat, fileStats };
});

vi.mock('@actions/glob', () => ({ create: createGlob }));
vi.mock('fs/promises', () => ({ lstat }));

import { computeContentDigest } from '../src/content-manifest';

function mockGlob(files: string[], searchPaths: string[]) {
  createGlob.mockResolvedValue({
    getSearchPaths: () => searchPaths,
    globGenerator: async function* () {
      for (const f of files) yield f;
    },
  });
}

describe('computeContentDigest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(fileStats)) delete fileStats[k];
  });

  it('returns a stable digest for the same file set', async () => {
    mockGlob(['/base/a.txt', '/base/sub/b.txt'], ['/base']);
    fileStats['/base/a.txt'] = { size: 10 };
    fileStats['/base/sub/b.txt'] = { size: 20 };

    const d1 = await computeContentDigest('/base');
    // Recompute identically.
    mockGlob(['/base/sub/b.txt', '/base/a.txt'], ['/base']); // different yield order
    fileStats['/base/a.txt'] = { size: 10 };
    fileStats['/base/sub/b.txt'] = { size: 20 };
    const d2 = await computeContentDigest('/base');

    expect(d1).toMatch(/^[0-9a-f]{64}$/);
    expect(d2).toBe(d1); // order-independent
  });

  it('changes when a file is added', async () => {
    mockGlob(['/base/a.txt'], ['/base']);
    fileStats['/base/a.txt'] = { size: 10 };
    const before = await computeContentDigest('/base');

    mockGlob(['/base/a.txt', '/base/c.txt'], ['/base']);
    fileStats['/base/a.txt'] = { size: 10 };
    fileStats['/base/c.txt'] = { size: 5 };
    const after = await computeContentDigest('/base');

    expect(after).not.toBe(before);
  });

  it('changes when a file is removed', async () => {
    mockGlob(['/base/a.txt', '/base/c.txt'], ['/base']);
    fileStats['/base/a.txt'] = { size: 10 };
    fileStats['/base/c.txt'] = { size: 5 };
    const before = await computeContentDigest('/base');

    mockGlob(['/base/a.txt'], ['/base']);
    fileStats['/base/a.txt'] = { size: 10 };
    const after = await computeContentDigest('/base');

    expect(after).not.toBe(before);
  });

  it('changes when a file size changes', async () => {
    mockGlob(['/base/a.txt'], ['/base']);
    fileStats['/base/a.txt'] = { size: 10 };
    const before = await computeContentDigest('/base');

    mockGlob(['/base/a.txt'], ['/base']);
    fileStats['/base/a.txt'] = { size: 11 };
    const after = await computeContentDigest('/base');

    expect(after).not.toBe(before);
  });

  it('does NOT detect a same-size in-place edit (documented blind spot)', async () => {
    mockGlob(['/base/a.txt'], ['/base']);
    fileStats['/base/a.txt'] = { size: 10 };
    const before = await computeContentDigest('/base');

    // Same path, same size, different bytes — size+path manifest cannot see this.
    mockGlob(['/base/a.txt'], ['/base']);
    fileStats['/base/a.txt'] = { size: 10 };
    const after = await computeContentDigest('/base');

    expect(after).toBe(before);
  });

  it('ignores directory entries', async () => {
    mockGlob(['/base/sub', '/base/sub/b.txt'], ['/base']);
    fileStats['/base/sub'] = { size: 4096, dir: true };
    fileStats['/base/sub/b.txt'] = { size: 20 };
    const withDir = await computeContentDigest('/base');

    mockGlob(['/base/sub/b.txt'], ['/base']);
    fileStats['/base/sub/b.txt'] = { size: 20 };
    const fileOnly = await computeContentDigest('/base');

    expect(withDir).toBe(fileOnly);
  });

  it('returns empty string for an empty path input', async () => {
    expect(await computeContentDigest('')).toBe('');
    expect(await computeContentDigest('\n  \n')).toBe('');
    expect(createGlob).not.toHaveBeenCalled();
  });

  it('returns empty string when nothing matches', async () => {
    mockGlob([], ['/base']);
    expect(await computeContentDigest('/base')).toBe('');
  });

  it('returns empty string when glob throws', async () => {
    createGlob.mockRejectedValue(new Error('glob boom'));
    expect(await computeContentDigest('/base')).toBe('');
  });

  it('returns empty string when lstat throws', async () => {
    mockGlob(['/base/missing.txt'], ['/base']);
    // fileStats not populated -> lstat throws -> caught -> ''
    expect(await computeContentDigest('/base')).toBe('');
  });

  it('excludes negated paths via the same glob pattern string', async () => {
    // The negation is honoured by @actions/glob itself; we assert the joined pattern is passed through.
    mockGlob(['/base/a.txt'], ['/base']);
    fileStats['/base/a.txt'] = { size: 10 };
    await computeContentDigest('/base\n! /base/ignored');
    expect(createGlob).toHaveBeenCalledWith('/base\n!/base/ignored', expect.any(Object));
  });
});
