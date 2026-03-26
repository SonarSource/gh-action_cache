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

## Development

### Prerequisites

- Node.js 20+
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

The JS sub-actions (`credential-setup`, `credential-guard`) are bundled with
`@vercel/ncc` into self-contained dist files. Rebuild after changing TypeScript source:

```bash
npm run build         # build all sub-actions
npm run build:setup   # build credential-setup only
npm run build:guard-main  # build credential-guard main only
npm run build:guard-post  # build credential-guard post only
```

Bundled output goes to `credential-setup/dist/` and `credential-guard/dist/`.
These must be committed since GitHub Actions runs them directly.

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

| Environment Variable  | Description                                                                       |
|-----------------------|-----------------------------------------------------------------------------------|
| `CACHE_BACKEND`       | Force specific backend: `github` or `s3` (overrides auto-detection)               |
| `CACHE_IMPORT_GITHUB` | Disable GitHub cache fallback for S3 backend (migration mode) when set to `false` |

## Inputs

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

## Backend Selection

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

## Migration Mode (GitHub cache → S3)

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

## Outputs

| Output      | Description                                    |
|-------------|------------------------------------------------|
| `cache-hit` | Boolean indicating exact match for primary key |

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
| List all cache entries         | _(empty)_           | _(empty)_        | n/a     |
| Preview what would be deleted  | `feature/my-branch` | _(optional)_     | `true`  |
| Delete cache for a branch      | `feature/my-branch` | _(optional)_     | `false` |
| Delete key for given branch    | `feature/my-branch` | `sccache-Linux-` | `false` |
| Delete key across all branches | _(empty)_           | `sccache-Linux-` | `false` |

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
