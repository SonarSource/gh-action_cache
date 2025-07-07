# Adaptive Cache Action

A GitHub Action that automatically selects the optimal caching backend based on repository visibility:
- **Public repositories**: Uses GitHub Actions cache for free, fast caching
- **Private/Internal repositories**: Uses AWS S3 with branch-specific paths for enhanced security and granular permissions

## Features

- **Adaptive backend selection**: Automatically chooses GitHub Actions cache for public repos, S3 for private/internal repos
- **Branch-specific caching**: For S3 backend, cache entries are prefixed with branch name for granular permissions
- **Intelligent fallback**: Feature branches can fall back to default branch cache when no branch-specific cache exists
- **Zero configuration**: Works out of the box with automatic repository visibility detection
- **S3 storage**: Leverages AWS S3 for reliable, scalable cache storage in private repositories
- **AWS Cognito authentication**: Secure authentication using GitHub Actions OIDC tokens (S3 backend only)
- **Compatible with actions/cache**: Drop-in replacement with same interface

## Usage

```yaml
- uses: SonarSource/gh-action_cache@v1
  with:
    path: |
      ~/.npm
      ~/.cache
    key: node-${{ runner.os }}-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      node-${{ runner.os }}
    # s3-bucket only used for private/internal repositories
    s3-bucket: your-cache-bucket
```

## How It Works

The action automatically detects your repository's visibility and selects the appropriate cache backend:

### Public Repositories
- Uses GitHub Actions cache (`actions/cache@v4`)
- No AWS configuration required
- Standard cache key structure
- Free GitHub Actions cache limits apply

### Private/Internal Repositories  
- Uses S3 cache with runs-on/cache
- Requires AWS S3 bucket configuration
- Branch-specific cache paths for isolation
- AWS Cognito authentication via OIDC tokens

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `path` | Files, directories, and wildcard patterns to cache | Yes | |
| `key` | Explicit key for restoring and saving cache | Yes | |
| `restore-keys` | Ordered list of prefix-matched keys for fallback | No | |
| `s3-bucket` | S3 bucket name for cache storage (private/internal repos only) | No | `sonarsource-s3-cache-dev-bucket` |
| `upload-chunk-size` | Chunk size for large file uploads (bytes) | No | |
| `enableCrossOsArchive` | Enable cross-OS cache compatibility | No | `false` |
| `fail-on-cache-miss` | Fail workflow if cache entry not found | No | `false` |
| `lookup-only` | Only check cache existence without downloading | No | `false` |

## Outputs

| Output | Description |
|--------|-------------|
| `cache-hit` | Boolean indicating exact match for primary key |

## Cache Backend Selection

The action automatically determines which cache backend to use based on repository visibility:

```bash
# Detection logic
if repository.visibility == "public":
    use GitHub Actions cache
else:
    use S3 cache with branch-specific paths
```

### GitHub Actions Cache (Public Repos)
- **Pros**: Free, fast, no configuration needed
- **Cons**: Limited to 10GB per repository, 7-day retention
- **Use case**: Open source projects, public repositories

### S3 Cache (Private/Internal Repos)
- **Pros**: Unlimited storage, configurable retention, branch isolation
- **Cons**: Requires AWS setup, incurs S3 costs
- **Use case**: Private codebases requiring enhanced security

## Security

- **GitHub Actions Cache**: Uses GitHub's built-in security model
- **S3 Cache**: Uses GitHub Actions OIDC tokens for secure authentication
- No long-lived AWS credentials required
- Branch-specific paths provide isolation between branches (S3 only)
