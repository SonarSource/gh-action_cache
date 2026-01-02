# `gh-action_cache`

Adaptive cache action that automatically chooses the appropriate caching backend based on repository visibility and ownership.

- Automatically uses GitHub Actions cache for public repositories
- Uses SonarSource S3 cache for private/internal SonarSource repositories
- Seamless API compatibility with standard GitHub Actions cache
- Supports all standard cache inputs and outputs
- Automatic repository visibility detection

## Requirements

- `jq`

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
| `backend`              | Force specific backend: `github` or `s3`                                                                                                         | No       |         |

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

This action creates a dedicated AWS profile (`gh-action-cache-<run_id>`) to store its credentials.
This ensures that cache operations work correctly even when you configure your own AWS credentials later in the workflow.

**Why this matters**: The cache save operation happens in a GitHub Actions post-step (after your job completes).
If you use `aws-actions/configure-aws-credentials` during your job, it would normally override the cache action's credentials,
causing cache save to fail.

**Example workflow that works correctly**:

```yaml
jobs:
  build:
    steps:
      # Cache action authenticates and stores credentials in isolated profile
      - uses: SonarSource/gh-action-cache@v1
        with:
          path: ~/.cache
          key: my-cache-${{ hashFiles('**/lockfile') }}

      # Your own AWS authentication - does NOT affect cache credentials
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789:role/my-role
          aws-region: us-east-1

      - run: aws s3 ls  # Uses YOUR credentials

      # Post-step: Cache save uses isolated profile - works correctly!
```

### Cleanup Policy

The AWS S3 bucket lifecycle rules apply to delete the old files. The content from default branches expires in 60 days and for feature
branches in 30 days.
