# Native S3 build storage

This entry point stores caches and same-run build artifacts entirely in S3. It uses the shared Cognito/OIDC authentication
without changing the caller's AWS environment or configuration. The existing root action retains its legacy backends.

See [action.yml](action.yml) for the input and output contract. Jobs require `id-token: write` and `contents: read`.
Storage uses the existing branch-scoped cache permissions; no bucket or IAM deployment is required.
Pin an immutable action commit during evaluation.

## Cache ownership

```yaml
- uses: SonarSource/gh-action_cache/s3@<commit>
  id: dependencies
  with:
    operation: cache
    path: node_modules
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    lookup-only: 'true'
    save: 'true'
- if: steps.dependencies.outputs.cache-hit != 'true'
  run: npm ci
```

A producer can probe without downloading and publish in its success-only post step. A consumer omits `save` (default false);
use `fail-on-cache-miss: true` for required restores. Merge-queue refs cannot save. Keys resolve within the current ref first,
followed by readable PR base and default branch; each scope checks the exact key before ordered restore prefixes.
Existing credentials permit fallback reads only from `main`, `master` and `branch-*`; other bases are skipped with a warning.
An exact logical fallback hit counts as a cache hit and suppresses redundant publication.

Cache manifests publish conditionally after a complete payload upload, so concurrent producers cannot replace an existing result.
This namespace starts cold and does not import GitHub caches. Canonical PR refs remain isolated inside the existing head-branch
permission scope. Physical objects use the bucket's existing 30-day lifecycle. Automatic PR-close cleanup needs caller integration.

## Build artifacts

Upload with `operation: upload`, an exact `name`, and `path` globs. Download with `operation: download`, the same name, and a destination.
Artifacts are restricted to the current repository, canonical ref and run ID. The consumer selects the newest published producer
attempt, allowing a downstream-only retry to use earlier outputs. Publishing the same name twice in one attempt fails.

Artifact downloads expire after one day. Expired manifests are rejected before payload download. Physical objects remain under the
existing 30-day cache lifecycle and can incur storage charges until removed. Archives must match the manifest's SHA-256 and byte count
before extraction. Tar archives preserve executable bits and symlinks and honor exclusions. Hidden cache files are included;
hidden artifact files are excluded.

The default `environment: prod` reuses the standard production cache bucket and Cognito/OIDC credentials. To run the native
Linux/Windows smoke test from an unmerged branch, dispatch `Test cache lifecycles` with `verify-native-storage: true`.
