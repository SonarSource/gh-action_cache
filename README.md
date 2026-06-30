# `gh-action_cache`

Adaptive cache action that uses SonarSource S3 cache for all repositories, with seamless compatibility with the standard GitHub Actions
cache interface.

- Uses SonarSource S3 cache for all repositories (public, private, and internal)
- Seamless API compatibility with standard GitHub Actions cache
- Supports all standard cache inputs and outputs
- Automatic migration from GitHub Actions cache to S3 (no cold starts)

## Requirements

- `jq` (used by the cache key preparation script)
- `id-token: write` permission (required for OIDC authentication with S3 backend)

## Usage

```yaml
- uses: SonarSource/gh-action_cache@v1
  with:
    path: |
      ~/.cache/pip
      ~/.cache/maven
    key: cache-${{ runner.os }}-${{ hashFiles('**/requirements.txt', '**/pom.xml') }}
    restore-keys: cache-${{ runner.os }}-
```

### Input Environment Variables

| Environment Variable  | Description                                                                                                                                                                   |
|-----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `CACHE_BACKEND`       | Force specific backend: `github` or `s3` (overrides auto-detection).                                                                                                          |
| `CACHE_IMPORT_GITHUB` | Disable GitHub cache fallback for S3 backend (migration mode) when set to `false`.                                                                                            |
| `CI_METRICS_ENABLED`  | Pipeline-runtime-metrics gate (Linux only). `'true'` → on; `'false'` → off. Without an explicit workflow `env:` override, falls back to `${CI_METRICS_DIR}/enabled` presence. |
| `CI_METRICS_DIR`      | Holds the runner-side decision file (`enabled`) and per-invocation `cache-*.json` files. Defaults to `/tmp/ci-metrics`; set by ARC pod template or WarpBuild AMI.             |

### Inputs

| Input                        | Description                                                                                                                                      | Required | Default                                                                                                  |
|------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|----------|----------------------------------------------------------------------------------------------------------|
| `path`                       | Files, directories, and wildcard patterns to cache                                                                                               | Yes      |                                                                                                          |
| `key`                        | Explicit key for restoring and saving cache                                                                                                      | Yes      |                                                                                                          |
| `restore-keys`               | Ordered list of prefix-matched keys for fallback                                                                                                 | No       |                                                                                                          |
| `fallback-to-default-branch` | Automatically add a fallback restore key pointing to the default branch cache (S3 backend only). Disable if you want strict branch isolation.    | No       | `true`                                                                                                   |
| `fallback-branch`            | Optional maintenance branch for fallback restore keys (pattern: `branch-*`, S3 backend only). If not set, the repository default branch is used. | No       |                                                                                                          |
| `environment`                | Environment to use (dev or prod, S3 backend only)                                                                                                | No       | `prod`                                                                                                   |
| `upload-chunk-size`          | Chunk size for large file uploads (bytes)                                                                                                        | No       |                                                                                                          |
| `enableCrossOsArchive`       | Enable cross-OS cache compatibility                                                                                                              | No       | `false`                                                                                                  |
| `fail-on-cache-miss`         | Fail workflow if cache entry not found                                                                                                           | No       | `false`                                                                                                  |
| `lookup-only`                | Only check cache existence without downloading                                                                                                   | No       | `false`                                                                                                  |
| `backend`                    | Force specific backend: `github` or `s3`. Takes priority over `CACHE_BACKEND` env var and auto-detection.                                        | No       |                                                                                                          |
| `import-github-cache`        | Import GitHub cache to S3 when no S3 cache exists (migration mode, S3 backend only). Takes priority over `CACHE_IMPORT_GITHUB` env var.          | No       | `true` when backend is explicitly forced to `s3` or for public repos; `false` for private/internal repos |

### Backend Selection

The cache backend is determined in the following priority order:

1. **`inputs.backend`** — explicit input in the action step (`github` or `s3`)
2. **`CACHE_BACKEND` environment variable** — set at the job or workflow level (`github` or `s3`)
3. **Default** — `s3` for all repositories (public, private, and internal)

The `CACHE_BACKEND` env var is useful when the cache action is called indirectly through a composite action, and you cannot set the
`backend` input directly, or when you want to enforce the same backend for all cache steps in a workflow without modifying each step:

```yaml
env:
  CACHE_BACKEND: s3   # forces S3 for all cache steps, including those in reusable actions
```

### Migration Mode (GitHub cache → S3)

When switching from GitHub Actions cache to S3, existing cache entries live only in GitHub and would need to be rebuilt from scratch.
Migration mode bridges this gap: when using the S3 backend and no S3 cache exists, the action automatically falls back to restore
from GitHub Actions cache using the original key. The S3 post-job step then saves the restored content to S3, pre-provisioning it
for subsequent runs.

Migration mode is **enabled by default** in two cases:

- **Backend explicitly forced to S3** (`backend: s3` input or `CACHE_BACKEND=s3` env var) — the typical opt-in migration scenario.
- **Public repository with auto-detected backend** — public repositories previously used GitHub Actions cache by default; migration
  is enabled automatically so their first run after the upgrade remains a warm cache hit.

It is **disabled by default** for private/internal repositories with auto-detected backend, since those repositories have always
used S3 and have no GitHub cache entries to migrate.

Once all relevant entries have been migrated to S3, disable it to avoid the overhead of the GitHub fallback attempt on every cache miss.

**Resolution order** (first match wins):

1. **`import-github-cache: 'false'`** — action input in the step
2. **`CACHE_IMPORT_GITHUB=false`** — environment variable at job or workflow level (can be sourced from a repository variable)
3. **`true`** if backend was explicitly forced to `s3` (opt-in migration scenario)
4. **`true`** if backend was auto-detected and repository is **public** (previously used GitHub cache by default)
5. **`false`** if backend was auto-detected and repository is **private/internal** (always used S3, no GitHub cache to migrate)

**Disabling via repository variable** (recommended for gradual rollout):

```yaml
env:
  CACHE_BACKEND: s3   # forces S3 for all cache steps, including those in reusable actions
  CACHE_IMPORT_GITHUB: ${{ vars.CACHE_IMPORT_GITHUB }} # source from repository variable for easy toggle without workflow changes

jobs:
  build:
    steps:
      - uses: SonarSource/gh-action_cache@v1
```

Set the `CACHE_IMPORT_GITHUB` repository variable to `false` once migration is complete — no workflow changes needed.

**Behavior with `fail-on-cache-miss`:** when migration mode is active, the S3 miss does not immediately fail the job.
The action tries the GitHub fallback first and only fails if both S3 and GitHub report a cache miss.

### Checking migration progress

`gh-action_cache` ships a sample workflow at `.github/workflows/check-cache-migration.yml` that you must **copy into
each repository** using the S3 backend. It compares GitHub cache entries against S3 objects for that repository and
automatically disables the import fallback once migration is complete.

**What it checks:** branches matching `main`, `master`, `branch-*`, `dogfood-on-*`, `feature/long/*`, excluding
transient keys (`build-number-*`, `mise-*`).

**When all included entries are present in S3**, the workflow automatically sets `CACHE_IMPORT_GITHUB=false` as a
repository variable, disabling the import fallback for all subsequent runs if the environment variable is set with
`${{ vars.CACHE_IMPORT_GITHUB }}` in the workflow.

**Trigger manually via GitHub CLI:**

```bash
# Check prod environment (default)
gh workflow run check-cache-migration.yml

# Check dev environment
gh workflow run check-cache-migration.yml -f environment=dev
```

To re-enable migration mode after it has been automatically disabled, delete or reset the repository variable:

```bash
gh variable delete CACHE_IMPORT_GITHUB
# or
gh variable set CACHE_IMPORT_GITHUB --body "true"
```

### Outputs

| Output              | Description                                                                                                                                   |
|---------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| `cache-hit`         | Boolean indicating an exact match for the primary key.                                                                                        |
| `cache-matched-key` | The cache key for which a match was found — primary key on an exact hit, restore key on a partial hit, empty on a miss.                       |
| `restore-key-hit`   | The restore key that was prefix-matched. Populated only when `cache-hit` is `false` AND a restore key matched (partial hit). Empty otherwise. |
| `backend`           | The cache backend that was actually used (`github` or `s3`).                                                                                  |
| `cache-size-bytes`  | Total size in bytes of the cached path(s) at restore-time. Requires GNU `du` (Linux); empty on other platforms.                               |

### Pipeline runtime metrics

When the gate resolves to "on", the action writes a per-invocation JSON record to
`${CI_METRICS_DIR}/cache-${step}.json` for the [pipeline runtime metrics](https://sonarsource.atlassian.net/browse/BUILD-11068)
`job-completed.sh` hook to ingest. The output directory is taken from the `CI_METRICS_DIR` environment variable (provided by the
ARC pod template / WarpBuild AMI); it falls back to `/tmp/ci-metrics` when the variable is unset or empty.
The record is written on all platforms once the gate resolves to "on" (see Gate resolution below).
Size fields (`size_bytes_restored`, `size_bytes_at_end`) are `null` on non-Linux (no GNU `du`);
all other fields (`cache_hit`, `restore_key_hit`, `backend`, `saved`, timestamps, `key`) are populated on every platform.

**Gate resolution**:

The gate evaluates the workflow-level `env:` block first, then falls back to the presence-only file written by the runner pre-job hook:

1. Workflow `env: { CI_METRICS_ENABLED: 'false' }` → off (beats everything; removes `${CI_METRICS_DIR}/enabled` too).
2. Workflow `env: { CI_METRICS_ENABLED: 'true' }` → on (beats the runner-side decision; touches `${CI_METRICS_DIR}/enabled` too).
3. Otherwise, on iff `${CI_METRICS_DIR}/enabled` exists (written by the runner pre-job hook `job-started.sh`, which evaluates
   the per-env / per-repo / per-workflow allow/deny lists). On runners without the hook the file is absent → metrics are off.

When the gate resolves to "off", the cache flow runs exactly as before — no metrics steps, no JSON file, and `cache-size-bytes` is empty.
The other outputs (`cache-hit`, `cache-matched-key`, `restore-key-hit`, `backend`) are unaffected.

**Example — partial restore-key hit (primary missed, prefix-matched older entry restored, then re-saved under primary key):**

```json
{
    "step": "cache-python",
    "key": "python-Linux-pytest-requests",
    "restore-key-hit": "python-Linux-",
    "backend": "s3",
    "cache-hit": false,
    "size-bytes-restored": 120000000,
    "size-bytes-at-end": 482344960,
    "saved": true,
    "timestamp-restored": "2026-05-12T10:42:11.000Z",
    "timestamp-at-end": "2026-05-12T10:45:33.000Z"
}
```

**Example — exact hit (primary key matched, cache action skips save):**

```json
{
    "step": "cache-maven",
    "key": "maven-deps-abc123",
    "restore-key-hit": null,
    "backend": "s3",
    "cache-hit": true,
    "size-bytes-restored": 471859200,
    "size-bytes-at-end": 471859200,
    "saved": false,
    "timestamp-restored": "2026-05-12T10:42:11.000Z",
    "timestamp-at-end": "2026-05-12T10:45:33.000Z"
}
```

Field semantics:

| Field                 | Meaning                                                                                                                                                                                                                                         |
|-----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `step`                | Slugified id of the calling step (e.g. `cache-python`). Distinguishes multiple cache invocations in the same job.                                                                                                                               |
| `key`                 | Primary cache key.                                                                                                                                                                                                                              |
| `cache-hit`           | `true` if the primary key was an exact match. Drives the `saved` outcome.                                                                                                                                                                       |
| `restore-key-hit`     | When `cache-hit` is `false` AND a prefix-matched restore key was found, the matched restore key. `null` otherwise (exact hit, no match, or lookup-only).                                                                                        |
| `size-bytes-restored` | Size of the cache content at restore-time. `0` on a full miss with no partial hit.                                                                                                                                                              |
| `size-bytes-at-end`   | Size of the path at job end (measured in the post step, before the cache save runs). Reflects what *would* be saved when `saved` is true. When `saved` is false, this value still reports the path size at end-of-job but nothing is persisted. |
| `saved`               | `true` if the cache action actually persists the cache. `false` when `cache-hit` was true (cache action skips save on exact match) or when `lookup-only` was set.                                                                               |

The metrics step fails open — if measurement fails for any reason, the cache flow continues unaffected.

## S3 Cache Action

A GitHub Action that provides branch-specific caching on AWS S3 with intelligent fallback to default branch cache entries.

### Features

- **Branch-specific caching**: Cache entries are prefixed with `GITHUB_HEAD_REF` for granular permissions
- **Intelligent fallback**: Feature branches can fall back to default branch cache when no branch-specific cache exists
- **S3 storage**: Leverages AWS S3 for reliable, scalable cache storage
- **AWS Cognito authentication**: Secure authentication using GitHub Actions OIDC tokens
- **Compatible with actions/cache**: Drop-in replacement with same interface

### How Restore Keys Work

#### Cache Key Resolution Order

The action searches for cache entries in this order:

1. **Primary key**: `${BRANCH_NAME}/${key}` (exact match)
2. **Default branch exact-match fallback** (when `fallback-to-default-branch: true`): `refs/heads/${DEFAULT_BRANCH}/${key}`
3. **Branch-specific restore keys** (if `restore-keys` provided): `${BRANCH_NAME}/${restore-key}` for each restore key (prefix match)
4. **Default branch restore key fallbacks** (if `restore-keys` provided):
   `refs/heads/${DEFAULT_BRANCH}/${restore-key}` for each restore key (prefix match, lowest priority)

#### Example — with restore-keys

```yaml
- uses: SonarSource/gh-action_cache@v1
  with:
    path: ~/.npm
    key: node-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
    restore-keys: node-${{ runner.os }}-
```

For a feature branch `feature/new-ui`, this will search for:

1. `feature/new-ui/node-linux-abc123...` (exact match)
2. `refs/heads/main/node-linux-abc123...` (default branch fallback, exact match)
3. `feature/new-ui/node-linux-` (branch-specific prefix match)
4. `refs/heads/main/node-linux-` (default branch fallback, prefix match)

#### Example — without restore-keys

```yaml
- uses: SonarSource/gh-action_cache@v1
  with:
    path: ~/.npm
    key: node-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
```

For a feature branch `feature/new-ui`, this will search for:

1. `feature/new-ui/node-linux-abc123...` (exact match)
2. `refs/heads/main/node-linux-abc123...` (exact-match fallback on default branch)

To disable the automatic default branch fallback:

```yaml
- uses: SonarSource/gh-action_cache@v1
  with:
    path: ~/.npm
    key: node-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
    fallback-to-default-branch: false
```

#### Key Differences from Standard Cache Action

- **Automatic default branch fallback**: By default, feature branches fall back to the default branch cache
  when no branch-specific entry exists
- **Dynamic default branch detection**: The action detects your default branch using the GitHub API and uses it for fallback
- **Branch isolation**: Each branch maintains its own cache namespace, preventing cross-branch cache pollution
- **No redundant save of default-branch content**: When a feature branch finds no branch-scoped entry and restores byte-identical content
  from the default-branch fallback (same `key`), the action skips re-saving that content under the branch-scoped key — it would just be a
  duplicate of the default-branch cache. Jobs that actually produce new content (their `key` does not match the default-branch cache)
  still save normally. A consequence is that such a feature-branch job does not create its own branch-scoped copy and will re-restore
  from the default-branch fallback on its next run.

### Environment Configuration

The action supports two environments:

- **dev**: Development environment with development S3 bucket
- **prod**: Production environment with production S3 bucket (default)

Each environment has its own preconfigured S3 bucket and AWS Cognito pool for isolation and security.

### Security

- Uses GitHub Actions OIDC tokens for secure authentication
- No long-lived AWS credentials required
- Branch-specific paths provide isolation between branches

### AWS Credential Isolation

This action uses a JS-based credential guard to ensure cache operations work correctly even when
other steps in your workflow configure different AWS credentials.

**How it works:**

1. `credential-setup` obtains temporary AWS credentials via GitHub OIDC + Cognito
2. Credentials are saved to a protected temp file and passed to the cache step via outputs
3. The cache restore step uses step-level `env:` from outputs — isolated from GITHUB_ENV
4. `credential-guard` post-step re-exports credentials to GITHUB_ENV for cache save (LIFO ordering)

**This protects against:**

- `aws-actions/configure-aws-credentials` overwriting credentials mid-job
- `aws-actions/configure-aws-credentials` cleanup clearing credentials
- Any step writing to `GITHUB_ENV` with different AWS credential values
- Pre-existing `AWS_PROFILE` or `AWS_DEFAULT_PROFILE` in the environment
- Users configuring AWS credentials before or after the cache action

**Works regardless of credential ordering** — you can configure your AWS credentials
before or after the cache action:

```yaml
jobs:
  build:
    steps:
      # Your own AWS authentication — order does not matter
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789:role/my-role
          aws-region: us-east-1

      # Cache action authenticates independently via OIDC + Cognito
      - uses: SonarSource/gh-action-cache@v2
        with:
          path: ~/.cache
          key: my-cache-${{ hashFiles('**/lockfile') }}

      - run: aws s3 ls  # Uses YOUR credentials (cache never touches GITHUB_ENV)

      # Post-step: credential-guard restores cache creds, then cache saves!
```

### Cleanup Policy

The AWS S3 bucket lifecycle rules apply to delete the old files. The content from default branches expires in 60 days and for feature
branches in 30 days.

## Cache Cleanup

List or delete S3 cache entries for your repository without waiting for the 30-day lifecycle expiry.

### Setup

Add a cleanup workflow to your repository (must be on the default branch):

```yaml
# .github/workflows/cleanup-cache.yml
name: Cleanup S3 Cache

on:
  workflow_dispatch:
    inputs:
      branch:
        description: "Branch name (e.g., 'feature/my-branch'). Leave empty to list all entries."
        required: false
        type: string
        default: ""
      key:
        description: "Cache key prefix (e.g., 'sccache-Linux-')"
        required: false
        type: string
        default: ""
      dry-run:
        description: "Preview deletions without executing them"
        required: false
        type: boolean
        default: true

jobs:
  cleanup:
    runs-on: sonar-xs
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: SonarSource/gh-action_cache/cleanup@v1
        with:
          branch: ${{ inputs.branch }}
          key: ${{ inputs.key }}
          dry-run: ${{ inputs.dry-run }}
```

> **Important:** The cleanup workflow must be dispatched from a **default/protected branch** (e.g., `main` or `master`).
> This is required by the IAM policy for cross-branch cache deletion permissions.

### Modes of Operation

| Scenario                       | Branch              | Key              | Dry-run |
|--------------------------------|---------------------|------------------|---------|
| List all cache entries         | *(empty)*           | *(empty)*        | n/a     |
| Preview what would be deleted  | `feature/my-branch` | *(optional)*     | `true`  |
| Delete cache for a branch      | `feature/my-branch` | *(optional)*     | `false` |
| Delete key for given branch    | `feature/my-branch` | `sccache-Linux-` | `false` |
| Delete key across all branches | *(empty)*           | `sccache-Linux-` | `false` |

### Running via GitHub CLI

```bash
# List all cache entries for your repo
gh workflow run cleanup-cache.yml

# Preview deletions for a branch
gh workflow run cleanup-cache.yml -f branch="feature/my-branch" -f dry-run=true

# Delete all cache for a branch
gh workflow run cleanup-cache.yml -f branch="feature/my-branch" -f dry-run=false

# Delete specific cache key on a branch
gh workflow run cleanup-cache.yml -f branch="feature/my-branch" -f key="sccache-Linux-" -f dry-run=false
```

## Development

### Prerequisites

- Node.js 24+
- npm

### Install dependencies

```bash
npm install
```

### Run tests

```bash
npm test              # single run
npm run test:watch    # watch mode
```

### Build

The JS sub-actions (`credential-setup`, `credential-guard`, `cache-metrics`, `symlink-keeper`) are bundled with
`@vercel/ncc` into self-contained dist files. Rebuild after changing TypeScript source:

```bash
npm run build               # build all sub-actions
npm run build:setup         # build credential-setup only
npm run build:guard-main    # build credential-guard main only
npm run build:guard-post    # build credential-guard post only
npm run build:metrics-main  # build cache-metrics main only
npm run build:metrics-post  # build cache-metrics post only
npm run build:keeper-main   # build symlink-keeper main only
npm run build:keeper-post   # build symlink-keeper post only
```

Bundled output goes to `credential-setup/dist/`, `credential-guard/dist/`, `cache-metrics/dist/`, and `symlink-keeper/dist/`.
These must be committed since GitHub Actions runs them directly.

### Releasing

Releases are cut manually — there is no automated release workflow. Before making a release, ensure that all checks are green.

Tags follow SemVer: `vX.Y.Z`. Follow semantic versioning principles when determining the new version number based on the nature of the
changes (**new features**, improvements, fixes, documentation, and **breaking changes**).

1. Create a new GitHub release on <https://github.com/SonarSource/gh-action_cache/releases>

   Semantic versioning is crucial for clear communication of the changes in each release:

    - Increase the **patch** number for **bug fixes**, **improvements**, and **documentation updates**,
    - Increase the **minor** number for **new features**,
    - Increase the **major** number for **breaking changes**.

   Edit the generated release notes to curate the highlights and key fixes. Make sure that the notes are clear and informative.

    ```markdown
    ## What's Changed
    ### New Features
    * BUILD-... by @username in https://github.com/SonarSource/gh-action_cache/pull/...

    ### Improvements
    * ...

    ### Bug Fixes
    * ...

    ### Documentation
    * ...

    ## New Contributors
    * ...

    ---

    Additional notes, examples, or references if applicable.

    **Full Changelog**: https://github.com/SonarSource/gh-action_cache/compare/...
    ```

   Make sure to include any **breaking changes** in the notes.

2. After release, the `v*` branch must be updated for pointing to the new tag.

    ```shell
    git fetch --tags
    git update-ref -m "reset: update branch v1 to tag v1.y.z" refs/heads/v1 v1.y.z
    git push origin v1
    ```

3. Communicate Updates, Changes and Migrations

   Communicate the new release on the [#ops-platform-releases](https://sonarsource.enterprise.slack.com/archives/C0A6RL3L9BP) Slack
   channel.

   > 🚀 **New release `1.y.z` of `gh-action_cache`** (`v1` branch updated) 🚀
   >
   > ---
   >
   > ### ✨ What's New
   >
   > - *Curated highlights from release notes: new features, important new options*
   >
   > ### ⚡ Improvements
   >
   > - *Curated highlights from release notes: improvement and upgrades*
   >
   > ### 🐛 Bug Fixes
   >
   > - *Curated highlights from release notes*
   >
   > ### 📚 Documentation
   >
   > - *Curated highlights from release notes*
   >
   >
   > For all the details, you can
   > [read the full release notes on GitHub](https://github.com/SonarSource/gh-action_cache/releases/tag/v1.y.z).

   Communicate major updates, changes and migrations that require action from users following as indicated in
   the [Updates, Changes and Migrations for Squads - Platform](https://xtranet-sonarsource.atlassian.net/wiki/spaces/Platform/pages/4385374219/Updates+Changes+and+Migrations+for+Squads+-+Platform#Usage-of-Communication-Channels)
   xtranet page.

---

### symlink-keeper

`symlink-keeper` is an internal sub-action, not intended for external use. It exists to work around two GitHub Actions limitations:

- **Self-reference restriction**: a composite action cannot reference its own sub-actions by relative path at runtime — an external ref
  (`uses: SonarSource/gh-action_cache/symlink-keeper@<ref>`) is required.
- **Symlink destruction**: some external actions (e.g. `actions/checkout` with `clean: true`) delete symlinks created earlier in the job;
  `symlink-keeper` re-creates them as a post step.

It is versioned and released independently of the main cache action and referenced by version tag in the main action's workflow files (e.g.
`@symlink-keeper-1.0.0`).

During development, point references to a branch instead of a tag:

1. Create a branch `symlink-keeper-x.y.z` (e.g. `symlink-keeper-1.0.1`) with your changes.
2. Update all `@symlink-keeper-*` references in the codebase to `@symlink-keeper-x.y.z`.
3. Open a PR as usual and iterate on the branch.

#### Releasing symlink-keeper

After the PR is merged to `master`:

1. Create a GitHub release with tag `symlink-keeper-x.y.z` pointing to the merged commit.
2. Delete the `symlink-keeper-x.y.z` branch (the tag replaces it).

The tag is what callers pin to in production.
