import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';

// Execute the real action's conditions and shell scripts. Only remote actions are stubbed;
// in particular, combined actions intentionally expose no cache-matched-key output.
const root = resolve(__dirname, '..');
const action = parse(readFileSync(join(root, 'action.yml'), 'utf8'));
// Frozen release: changes to this fixture require an intentional compatibility decision.
const released = parse(readFileSync(join(__dirname, 'fixtures/action-v1.yml'), 'utf8'));
type Outputs = Record<string, string>;
interface Step {
  id?: string;
  name: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Outputs;
  with?: Record<string, string | boolean>;
}

function scenario(inputs: Outputs = {}, fixtures: Record<string, Outputs> = {}, ref = 'refs/pull/123/merge', definition = action) {
  const values: Outputs = {
    'github.ref': ref,
    'steps.cache-backend.outputs.cache-backend': inputs.backend ?? 's3',
    'steps.cache-backend.outputs.import-github': inputs['import-github-cache'] ?? 'true',
  };
  for (const [name, input] of Object.entries(definition.inputs) as [string, { default?: unknown }][]) {
    values[`inputs.${name}`] = String(input.default ?? '');
  }
  for (const [name, value] of Object.entries(inputs)) values[`inputs.${name}`] = value;
  values['inputs.key'] = 'key';
  const calls: { id: string; uses: string; payload: boolean; with: Record<string, string>; env: Outputs }[] = [];
  const executed: string[] = [];
  const directory = mkdtempSync(join(tmpdir(), 'cache-lifecycle-'));

  function evaluate(expression: string) {
    // This is repository-owned action metadata, never workflow event data or user expressions.
    const javascript = expression.replace(/(?:inputs|steps|github)\.[a-zA-Z0-9_.-]+/g,
      name => JSON.stringify(values[name] ?? ''));
    return runInNewContext(javascript) as string | boolean;
  }
  function render(value: string | boolean) {
    return String(value).replace(/\$\{\{([\s\S]*?)\}\}/g, (_, expression) => String(evaluate(expression)));
  }
  function setOutputs(id: string, outputs: Outputs) {
    for (const [name, value] of Object.entries(outputs)) values[`steps.${id}.outputs.${name}`] = value;
  }

  try {
    for (const step of definition.runs.steps as Step[]) {
      if (step.name === 'Resolve CI metrics gate') break;
      const id = step.id ?? step.name;
      if (id === 'cache-backend') continue;
      if (step.if && !evaluate(step.if)) {
        values[`steps.${id}.outcome`] = 'skipped';
        continue;
      }
      executed.push(id);
      if (id === 'prepare-keys') {
        setOutputs(id, { 'branch-key': 'pr/key', 'branch-restore-keys': 'pr/old-\nrefs/heads/master/key', 'fallback-exact-key': 'refs/heads/master/key' });
      } else if (step.uses) {
        const withValues = Object.fromEntries(Object.entries(step.with ?? {}).map(([k, v]) => [k, render(v)]));
        calls.push({ id, uses: step.uses, env: Object.fromEntries(Object.entries(step.env ?? {}).map(([k, v]) => [k, render(v)])), with: withValues, payload: id !== 'aws-auth' && withValues['lookup-only'] !== 'true' });
        setOutputs(id, fixtures[id] ?? {});
      } else if (step.run) {
        const output = join(directory, id.replace(/[^a-z0-9-]/gi, '_'));
        const env = Object.fromEntries(Object.entries(step.env ?? {}).map(([k, v]) => [k, render(v)]));
        execFileSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
          env: { ...process.env, ...env, ACTION_PATH_CACHE: root, GITHUB_OUTPUT: output },
          stdio: 'pipe',
        });
        if (step.id) {
          setOutputs(id, Object.fromEntries(readFileSync(output, 'utf8').trimEnd().split('\n').map(line => {
            const index = line.indexOf('=');
            return [line.slice(0, index), line.slice(index + 1)];
          })));
        }
      }
      values[`steps.${id}.outcome`] = 'success';
    }
    return {
      calls, executed,
      metrics: Object.fromEntries(Object.entries((definition.runs.steps as Step[]).find(s => s.id === 'cache-metrics')!.with!).map(([k, v]) => [k, render(v)])),
      guard: evaluate((definition.runs.steps as Step[]).find(s => s.name === 'Credential guard for S3 cache save')!.if!),
      outputs: Object.fromEntries(Object.entries(definition.outputs).map(([name, output]) =>
        [name, render((output as { value: string }).value)])),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const match = (key: string, hit = 'false') => ({ 'cache-matched-key': key, 'cache-hit': hit });
const savers = (result: ReturnType<typeof scenario>) => result.calls.filter(c => c.id.endsWith('-save') || c.id === 's3-cache' || c.id === 'github-cache');
const payloads = (result: ReturnType<typeof scenario>) => result.calls.filter(c => c.payload);

describe('explicit cache lifecycle', () => {
  it.each(['s3', 'github'])('never registers a saver for a %s restore-only miss', backend => {
    const result = scenario({ backend, save: 'false' });
    expect(savers(result)).toEqual([]);
    expect(result.outputs['cache-found']).toBe('false');
  });

  it.each(['s3', 'github'])('registers a %s post-save without downloading for a producer probe', backend => {
    const result = scenario({ backend, save: 'true', 'lookup-only': 'true' });
    expect(payloads(result)).toEqual([]);
    expect(savers(result)).toHaveLength(1);
    expect(savers(result)[0].with['lookup-only']).toBe('true');
    expect(result.outputs['cache-restored']).toBe('false');
  });

  it.each(['s3', 'github'])('keeps a %s pure probe free of downloads and savers', backend => {
    const result = scenario({ backend, save: 'false', 'lookup-only': 'true' });
    expect(payloads(result)).toEqual([]);
    expect(savers(result)).toEqual([]);
  });

  it.each([
    ['s3', 'true', 0], ['s3', 'false', 1], ['github', 'true', 1], ['github', 'false', 1],
  ])('preserves omitted-save behavior for %s lookup=%s', (backend, lookup, count) => {
    expect(savers(scenario({ backend: String(backend), 'lookup-only': String(lookup) }))).toHaveLength(Number(count));
  });

  it.each(['true', 'false'])('never registers an S3 merge-queue saver (lookup=%s)', lookup => {
    const result = scenario({ save: 'true', 'lookup-only': lookup }, {}, 'refs/heads/gh-readonly-queue/master/pr-123');
    expect(savers(result)).toEqual([]);
  });

  it('rejects an invalid save value before authenticating or restoring', () => {
    expect(() => scenario({ save: 'sometimes' })).toThrow();
  });
});

describe('selection, restoration and hit reporting', () => {
  it.each(['true', 'false'])('treats an exact default-branch key as a logical hit (lookup=%s)', lookup => {
    const key = 'refs/heads/master/key';
    const result = scenario({ save: 'true', 'lookup-only': lookup }, {
      's3-probe': match(key), 's3-restore': match(key, 'true'),
    });
    expect(result.outputs['cache-hit']).toBe('true');
    expect(result.outputs['cache-found']).toBe('true');
    expect(result.outputs['cache-restored']).toBe(lookup === 'true' ? 'false' : 'true');
    expect(result.outputs['cache-matched-key']).toBe(key);
    expect(result.outputs['restore-key-hit']).toBe('');
    expect(savers(result)).toEqual([]);
    expect(result.executed).not.toContain('github-import');
  });

  it('does not register a save for an exact current-branch match', () => {
    const result = scenario({ save: 'true' }, {
      's3-probe': match('pr/key', 'true'), 's3-restore': match('pr/key', 'true'),
    });
    expect(result.outputs['cache-hit']).toBe('true');
    expect(savers(result)).toEqual([]);
  });

  it('restores an S3 partial match once and never overlays the available GitHub exact hit', () => {
    const key = 'refs/heads/master/month-old';
    const result = scenario({ save: 'false', 'fail-on-cache-miss': 'true' }, {
      's3-probe': match(key), 's3-restore': match(key, 'true'), 'github-import': match('key', 'true'),
    });
    expect(payloads(result).map(c => c.id)).toEqual(['s3-restore']);
    expect(payloads(result)[0].with.key).toBe(key);
    expect(payloads(result)[0].with['restore-keys']).toBe('');
    expect(result.outputs['cache-hit']).toBe('false');
    expect(result.outputs['cache-found']).toBe('true');
    expect(result.outputs['restore-key-hit']).toBe(key);
    expect(savers(result)).toEqual([]);
  });

  it('allows a producer to restore a partial match once and register a metadata-only saver', () => {
    const key = 'pr/month-old';
    const result = scenario({ save: 'true' }, { 's3-probe': match(key), 's3-restore': match(key, 'true') });
    expect(payloads(result).map(c => c.id)).toEqual(['s3-restore']);
    expect(savers(result).map(c => c.id)).toEqual(['s3-save']);
    expect(result.outputs['cache-hit']).toBe('false');
  });

  it('reports the GitHub import result rather than an earlier S3 miss', () => {
    const result = scenario({ save: 'true', 'fail-on-cache-miss': 'true' }, { 'github-import': match('key', 'true') });
    expect(payloads(result).map(c => c.id)).toEqual(['github-import']);
    expect(result.outputs['cache-hit']).toBe('true');
    expect(result.outputs['cache-matched-key']).toBe('key');
    expect(savers(result).map(c => c.id)).toEqual(['s3-save']);
  });

  it('does not seed S3 from a restore-only GitHub fallback', () => {
    const result = scenario({ save: 'false' }, { 'github-import': match('key', 'true') });
    expect(result.outputs['cache-restored']).toBe('true');
    expect(savers(result)).toEqual([]);
  });

  it('does not claim a restored hit or overlay GitHub when the selected S3 object disappears', () => {
    const result = scenario({ save: 'false' }, {
      's3-probe': match('pr/key', 'true'), 'github-import': match('key', 'true'),
    });
    expect(result.outputs['cache-found']).toBe('false');
    expect(result.outputs['cache-hit']).toBe('');
    expect(result.outputs['cache-restored']).toBe('false');
    expect(result.executed).not.toContain('github-import');
  });

  it('fails a required miss even when the metadata probe previously matched', () => {
    expect(() => scenario({ save: 'false', 'fail-on-cache-miss': 'true' }, {
      's3-probe': match('pr/key', 'true'),
    })).toThrow();
  });

  it('does not contact GitHub when migration fallback is disabled', () => {
    const result = scenario({ save: 'false', 'import-github-cache': 'false' });
    expect(payloads(result)).toEqual([]);
    expect(result.outputs['cache-found']).toBe('false');
  });

  it('preserves a GitHub partial matched key with no combined-action output dependency', () => {
    const result = scenario({ backend: 'github', save: 'true' }, { 'github-restore': match('old-key') });
    expect(payloads(result).map(c => c.id)).toEqual(['github-restore']);
    expect(result.outputs['cache-hit']).toBe('false');
    expect(result.outputs['cache-matched-key']).toBe('old-key');
    expect(savers(result)).toHaveLength(1);
  });
});


describe('rolling-v1 compatibility without new inputs', () => {
  it('preserves every released public input and output expression', () => {
    for (const [name, input] of Object.entries(released.inputs)) expect(action.inputs[name]).toEqual(input);
    for (const [name, output] of Object.entries(released.outputs) as [string, { value: string }][]) {
      expect(action.outputs[name].value).toBe(output.value);
    }
  });

  const candidates: Record<string, Record<string, Outputs>> = {
    miss: {},
    'current exact': { 's3-probe': match('pr/key', 'true'), 's3-restore': match('pr/key', 'true'), 'github-cache': { 'cache-hit': 'true' } },
    'fallback exact': { 's3-probe': match('refs/heads/master/key'), 's3-restore': match('refs/heads/master/key') },
    partial: { 's3-probe': match('pr/old-key'), 's3-cache': { 'cache-hit': 'false' }, 's3-restore': match('pr/old-key'), 'github-cache': { 'cache-hit': 'false' } },
    'migration hit': { 'github-import': match('key', 'true') },
    'partial and migration hit': { 's3-probe': match('pr/old-key'), 's3-cache': { 'cache-hit': 'false' }, 's3-restore': match('pr/old-key'), 'github-import': match('key', 'true') },
    'probe disappeared': { 's3-probe': match('pr/key', 'true') },
  };
  for (const backend of ['github', 's3']) {
    for (const lookup of ['false', 'true']) {
      for (const migration of ['false', 'true']) {
        for (const ref of ['refs/pull/123/merge', 'refs/heads/gh-readonly-queue/master/pr-123']) {
          it.each(Object.entries(candidates))(`${backend} lookup=${lookup} import=${migration} ref=${ref}: %s`, (_, fixtures) => {
            const inputs = { backend, 'lookup-only': lookup, 'import-github-cache': migration };
            const old = scenario(inputs, fixtures, ref, released);
            const now = scenario(inputs, fixtures, ref);
            // Same remote actions, ordering, complete inputs, scoped AWS environment and post-save registrations.
            expect(now.calls).toEqual(old.calls);
            for (const name of Object.keys(released.outputs)) expect(now.outputs[name]).toBe(old.outputs[name]);
            const { 'save-enabled': saveEnabled, ...metrics } = now.metrics;
            expect(saveEnabled).toBe('');
            expect(metrics).toEqual(old.metrics);
            expect(now.guard).toBe(old.guard);
          });
        }
      }
    }
  }

  it.each(['', 'True', 'TRUE', 'False'])('does not validate previously accepted lookup-only=%s without opt-in', lookup => {
    const inputs = { 'lookup-only': lookup };
    const old = scenario(inputs, {}, undefined, released);
    const now = scenario(inputs);
    expect(now.calls).toEqual(old.calls);
    expect(now.outputs['cache-hit']).toBe(old.outputs['cache-hit']);
  });

  it.each(['false', 'true'])('retains legacy required-miss enforcement when import lookup=%s', lookup => {
    const inputs = { 'lookup-only': lookup, 'fail-on-cache-miss': 'true' };
    expect(() => scenario(inputs, {}, undefined, released)).toThrow();
    expect(() => scenario(inputs)).toThrow();
  });

  it('retains legacy fallback cache-hit and migration overlay semantics until explicitly opted in', () => {
    const fallback = { 's3-probe': match('refs/heads/master/key'), 's3-restore': match('refs/heads/master/key') };
    expect(scenario({}, fallback).outputs['cache-hit']).toBe('false');
    expect(scenario({ save: 'false' }, fallback).outputs['cache-hit']).toBe('true');
    const partial = { 's3-probe': match('pr/old-key'), 's3-cache': { 'cache-hit': 'false' }, 'github-import': match('key', 'true') };
    expect(payloads(scenario({}, partial)).map(c => c.id)).toEqual(['s3-cache', 'github-import']);
    expect(payloads(scenario({ save: 'false' }, partial)).map(c => c.id)).toEqual(['s3-restore']);
  });
});


it.each(['', 'true'])('isolates PR caches only in the opted-in lifecycle (%s)', isolate => {
  const directory = mkdtempSync(join(tmpdir(), 'cache-scope-'));
  const output = join(directory, 'outputs');
  try {
    execFileSync('bash', [join(root, 'scripts/prepare-keys.sh')], { env: {
      ...process.env, GITHUB_HEAD_REF: 'feature', GITHUB_REF: 'refs/pull/123/merge',
      GITHUB_TOKEN: 'unused', GITHUB_REPOSITORY: 'owner/repo', GITHUB_OUTPUT: output,
      INPUT_KEY: 'key', INPUT_RESTORE_KEYS: 'old-', INPUT_FALLBACK_BRANCH: 'master',
      INPUT_FALLBACK_TO_DEFAULT_BRANCH: 'false', ISOLATE_PR_CACHE: isolate,
    }});
    const result = readFileSync(output, 'utf8');
    const scope = isolate ? 'feature/refs/pull/123/merge' : 'feature';
    expect(result).toContain(`branch-key=${scope}/key\n`);
    expect(result).toContain(`${scope}/old-\n`);
    expect(result).toContain('fallback-exact-key=refs/heads/master/key\n');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
