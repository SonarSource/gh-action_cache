# `gh-action_cache`

Adaptive cache action that automatically chooses the appropriate caching backend based on repository visibility and ownership.

- Automatically uses GitHub Actions cache for public repositories
- Uses SonarSource S3 cache for private/internal SonarSource repositories
- Seamless API compatibility with standard GitHub Actions cache
- Supports all standard cache inputs and outputs
- Automatic repository visibility detection

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

Bundled output goes to `credential-setup/dist/` and `credential-guard/dist/`. These must be committed since GitHub Actions runs them directly.

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

## Inputs

| Input                  | Description                                                                                                                                      | Required | Default |
|------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------|----------|---------|
| `path`                 | Files, directories, and wildcard patterns to cache                                                                                               | Yes      |         |
| `key`                  | Explicit key for restoring and saving cache                                                                                                      | Yes      |         |
| `restore-keys`         | Ordered list of prefix-matched keys for fallback                                                                                                 | No       |         |
| `fallback-branch`      | Optional maintenance branch for fallback restore keys (pattern: `branch-*`, S3 backend only). If not set, the repository default branch is used. | No       |         |
| `environment`          | Environment to use (dev or prod, S3 backend only)                                                                                                | No       | `prod`  |
| `upload-chunk-size`    | Chunk size for large file uploads (bytes)                                                                                                        | No       |         |
| `enableCrossOsArchive` | Enable cross-OS cache compatibility                                                                                                              | No       | `false` |
| `fail-on-cache-miss`   | Fail workflow if cache entry not found                                                                                                           | No       | `false` |
| `lookup-only`          | Only check cache existence without downloading                                                                                                   | No       | `false` |
| `backend`              | Force specific backend: `github` or `s3`. Takes priority over `CACHE_BACKEND` env var and auto-detection.                                        | No       |         |

## Backend Selection

The cache backend is determined in the following priority order:

1. **`inputs.backend`** — explicit input in the action step (`github` or `s3`)
2. **`CACHE_BACKEND` environment variable** — set at the job or workflow level (`github` or `s3`)
3. **Repository visibility** — `github` for public repos, `s3` for private/internal repos

The `CACHE_BACKEND` env var is useful when the cache action is called indirectly through a composite action and you cannot set the `backend`
input directly:

```yaml
jobs:
  build:
    env:
      CACHE_BACKEND: s3   # forces S3 for all cache steps, including those in reusable actions
    steps:
      - uses: SonarSource/some-other-action@v1  # internally calls gh-action_cache
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

**Important**: This action's restore key behavior differs from the standard GitHub cache action.
To enable fallback to default branch caches, you **must** use the `restore-keys` property.

#### Cache Key Resolution Order

When you provide `restore-keys`, the action searches for cache entries in this order:

1. **Primary key**: `${BRANCH_NAME}/${key}`
2. **Branch-specific restore keys**: `${BRANCH_NAME}/${restore-key}` (for each restore key)
3. **Default branch fallbacks**:
    - `refs/heads/${DEFAULT_BRANCH}/${restore-key}` (for each restore key, where `DEFAULT_BRANCH` is dynamically obtained from the
      repository)

#### Example

```yaml
- uses: SonarSource/gh-action_cache@v1
  with:
    path: ~/.npm
    key: node-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
    restore-keys: node-${{ runner.os }}-
```

For a feature branch `feature/new-ui`, this will search for:

1. `feature/new-ui/node-linux-abc123...` (exact match)
2. `feature/new-ui/node-linux` (branch-specific partial match)
3. `refs/heads/main/node-linux` (default branch fallback, assuming `main` is the repository's default branch)

#### Key Differences from Standard Cache Action

- **Fallback requires restore-keys**: Without `restore-keys`, the action only looks for branch-specific cache entries
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

| Scenario | Branch | Key | Dry-run |
|----------|--------|-----|---------|
| List all cache entries | _(empty)_ | _(empty)_ | n/a |
| Preview what would be deleted | `feature/my-branch` | _(optional)_ | `true` |
| Delete cache for a branch | `feature/my-branch` | _(optional)_ | `false` |
| Delete key for given branch | `feature/my-branch`  | `sccache-Linux-` | `false` |
| Delete key across all branches | _(empty)_ | `sccache-Linux-` | `false` |

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
