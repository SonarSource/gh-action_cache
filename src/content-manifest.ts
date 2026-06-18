import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as glob from '@actions/glob';

/**
 * Compute a content digest of the cached file set, used to detect whether the cached path(s)
 * changed between cache restore (baseline, recorded in the main step) and cache save (final,
 * recorded in the post step). The digest is over the sorted "<relative-path>\t<size>" of every
 * regular file, so it catches additions, removals, renames and size changes — the ways a
 * content-addressed dependency cache (npm/pip/gradle/maven) drifts under a stable key.
 *
 * Deliberate choices:
 *  - Uses @actions/glob with the SAME pattern parsing the runs-on/cache save uses, so the file
 *    set matches what actually gets archived (~ expansion, wildcards, `!` negations).
 *  - implicitDescendants:true enumerates the transitive file set tar archives.
 *  - followSymbolicLinks:false mirrors tar (symlinks stored as links, not descended).
 *  - No mtime: avoids treating a touch-without-change as a change (which would over-save).
 *  - Returns '' on ANY failure or an empty match set; the caller treats '' as "save"
 *    (never skip), so the digest can only ever downgrade a key-based skip to a save.
 *
 * Known bounded limitation: a same-size in-place edit (same path, identical byte length) is not
 * detected. Irrelevant for content-addressed caches, where changes land at new paths.
 */
export async function computeContentDigest(pathInput: string): Promise<string> {
  try {
    // Mirror the upstream getInputAsArray: split lines, normalise `! pattern` -> `!pattern`, trim, drop empties.
    const patterns = pathInput
      .split('\n')
      .map((s) => s.replace(/^!\s+/, '!').trim())
      .filter((s) => s !== '');

    if (patterns.length === 0) {
      return '';
    }

    const globber = await glob.create(patterns.join('\n'), {
      implicitDescendants: true,
      followSymbolicLinks: false,
      matchDirectories: false,
    });

    // Relativise each matched file against the longest search-path base that contains it, so the
    // manifest records a stable logical sub-path (machine-independent, identical in main and post).
    const searchPaths = globber.getSearchPaths();

    const entries: string[] = [];
    for await (const file of globber.globGenerator()) {
      const stat = await fs.lstat(file);
      if (stat.isDirectory()) {
        continue;
      }
      const base = searchPaths.find((p) => file === p || file.startsWith(p + path.sep)) ?? path.dirname(file);
      const rel = path.relative(base, file).split(path.sep).join('/');
      // Symlinks: lstat().size is the link length; that is a stable discriminator without following.
      entries.push(`${rel}\t${stat.size}`);
    }

    if (entries.length === 0) {
      return '';
    }

    // Locale-independent (code-unit) ordering so the digest is stable across runners.
    entries.sort();

    const hash = crypto.createHash('sha256');
    for (const line of entries) {
      hash.update(line);
      hash.update('\n');
    }
    return hash.digest('hex');
  } catch {
    return '';
  }
}
