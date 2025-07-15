# S3 Cache Action

A GitHub Action that provides branch-specific caching on AWS S3 with intelligent fallback to default branch cache entries.

## Features

- **Branch-specific caching**: Cache entries are prefixed with `GITHUB_HEAD_REF` for granular permissions
- **Intelligent fallback**: Feature branches can fall back to default branch cache when no branch-specific cache exists
- **S3 storage**: Leverages AWS S3 for reliable, scalable cache storage
- **AWS Cognito authentication**: Secure authentication using GitHub Actions OIDC tokens
- **Compatible with actions/cache**: Drop-in replacement with same interface

## Usage

Recommended usage is to use with the
[`SonarSource/ci-github-actions/cache`](https://github.com/SonarSource/ci-github-actions?tab=readme-ov-file#cache) wrapper.

```yaml
- uses: SonarSource/ci-github-actions/cache@master
  with:
    path: |
      ~/.npm
      ~/.cache
    key: node-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      node-${{ runner.os }}
```

## How Restore Keys Work

**Important**: This action's restore key behavior differs from the standard GitHub cache action.
To enable fallback to default branch caches, you **must** use the `restore-keys` property.

### Cache Key Resolution Order

When you provide `restore-keys`, the action searches for cache entries in this order:

1. **Primary key**: `${BRANCH_NAME}/${key}`
2. **Branch-specific restore keys**: `${BRANCH_NAME}/${restore-key}` (for each restore key)
3. **Default branch fallbacks**:
    - `refs/heads/${DEFAULT_BRANCH}/${restore-key}` (for each restore key, where `DEFAULT_BRANCH` is dynamically obtained from the
      repository)

### Example

```yaml
- uses: SonarSource/ci-github-actions/cache@master
  with:
    path: ~/.npm
    key: node-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      node-${{ runner.os }}
```

For a feature branch `feature/new-ui`, this will search for:

1. `feature/new-ui/node-linux-abc123...` (exact match)
2. `feature/new-ui/node-linux` (branch-specific partial match)
3. `refs/heads/main/node-linux` (default branch fallback, assuming `main` is the repository's default branch)

### Key Differences from Standard Cache Action

- **Fallback requires restore-keys**: Without `restore-keys`, the action only looks for branch-specific cache entries
- **Dynamic default branch detection**: The action detects your default branch using the GitHub API and uses it for fallback
- **Branch isolation**: Each branch maintains its own cache namespace, preventing cross-branch cache pollution

## Inputs

| Input                  | Description                                        | Required | Default |
|------------------------|----------------------------------------------------|----------|---------|
| `path`                 | Files, directories, and wildcard patterns to cache | Yes      |         |
| `key`                  | Explicit key for restoring and saving cache        | Yes      |         |
| `restore-keys`         | Ordered list of prefix-matched keys for fallback   | No       |         |
| `environment`          | Environment to use (dev or prod)                   | No       | `prod`  |
| `upload-chunk-size`    | Chunk size for large file uploads (bytes)          | No       |         |
| `enableCrossOsArchive` | Enable cross-OS cache compatibility                | No       | `false` |
| `fail-on-cache-miss`   | Fail workflow if cache entry not found             | No       | `false` |
| `lookup-only`          | Only check cache existence without downloading     | No       | `false` |

## Outputs

| Output      | Description                                    |
|-------------|------------------------------------------------|
| `cache-hit` | Boolean indicating exact match for primary key |

## Environment Configuration

The action supports two environments:

- **dev**: Development environment with development S3 bucket
- **prod**: Production environment with production S3 bucket (default)

Each environment has its own preconfigured S3 bucket and AWS Cognito pool for isolation and security.

## Security

- Uses GitHub Actions OIDC tokens for secure authentication
- No long-lived AWS credentials required
- Branch-specific paths provide isolation between branches
