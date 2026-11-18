# Native S3 build storage

This entry point stores caches and same-run build artifacts entirely in S3. It uses the shared Cognito/OIDC authentication without
changing the caller's AWS environment or configuration. The existing root action retains its legacy backends and migration
behavior.

See [action.yml](action.yml) for the input and output contract. Jobs require `id-token: write` and `contents: read`. The bucket
must have the native ref-scoped IAM policy and one-day artifact lifecycle before use. Pin an immutable action commit during
evaluation.

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

A producer can probe without downloading and publish in its success-only post step. A consumer omits `save` (default false); use
`fail-on-cache-miss: true` for required restores. Merge-queue refs cannot save. Keys resolve within the current ref first,
followed by PR base and default branch; each scope checks the exact key before ordered restore prefixes. An exact logical fallback
hit counts as a cache hit and suppresses redundant publication.

Cache manifests publish conditionally after a complete payload upload, so concurrent producers cannot replace an existing result.
This namespace starts cold and does not import GitHub caches. Caches use the bucket's existing lifecycle; PR-close cleanup for
this namespace requires separate infrastructure/tooling.

## Build artifacts

Upload with `operation: upload`, an exact `name`, and `path` globs. Download with `operation: download`, the same name, and a
destination path. Artifacts are restricted to the current repository, ref and run ID. The consumer selects the newest published
producer attempt, allowing a downstream-only retry to use earlier outputs. Publishing the same name twice in one attempt fails.

Only one-day artifact retention is supported. Expired manifests are rejected before download; the bucket lifecycle handles
physical removal. Downloaded archives must match the manifest's SHA-256 and byte count before extraction. Tar archives preserve
executable bits and symlinks and honor exclusions. Hidden files are included in caches and excluded from artifacts.

Select `environment: dev` for a development-bucket trial. To run the native Linux/Windows smoke test from an unmerged branch,
dispatch `Test cache lifecycles` with `verify-native-storage: true` after the development storage policy is deployed.
