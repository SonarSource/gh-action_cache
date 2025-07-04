# S3 Cache Action

A GitHub Action that provides branch-specific caching on AWS S3 with intelligent fallback to default branch cache entries.

## Features

- **Branch-specific caching**: Cache entries are prefixed with `GITHUB_HEAD_REF` for granular permissions
- **Intelligent fallback**: Feature branches can fall back to default branch cache when no branch-specific cache exists
- **S3 storage**: Leverages AWS S3 for reliable, scalable cache storage
- **AWS Cognito authentication**: Secure authentication using GitHub Actions OIDC tokens
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
    s3-bucket: your-cache-bucket
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `path` | Files, directories, and wildcard patterns to cache | Yes | |
| `key` | Explicit key for restoring and saving cache | Yes | |
| `restore-keys` | Ordered list of prefix-matched keys for fallback | No | |
| `s3-bucket` | S3 bucket name for cache storage | No | `sonarsource-s3-cache-dev-bucket` |
| `upload-chunk-size` | Chunk size for large file uploads (bytes) | No | |
| `enableCrossOsArchive` | Enable cross-OS cache compatibility | No | `false` |
| `fail-on-cache-miss` | Fail workflow if cache entry not found | No | `false` |
| `lookup-only` | Only check cache existence without downloading | No | `false` |

## Outputs

| Output | Description |
|--------|-------------|
| `cache-hit` | Boolean indicating exact match for primary key |

## Security

- Uses GitHub Actions OIDC tokens for secure authentication
- No long-lived AWS credentials required
- Branch-specific paths provide isolation between branches
