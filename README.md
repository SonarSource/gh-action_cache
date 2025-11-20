# ccache S3 HTTP Proxy

A GitHub Action that provides an HTTP proxy for ccache remote storage backed by AWS S3.

## Features

- Transparent HTTP proxy for ccache remote cache storage
- Direct integration with AWS S3
- Automatic setup with mise, Python, and Poetry
- Background process that runs for the duration of the workflow

## Usage

```yaml
name: Build with ccache

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v5

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Start ccache S3 proxy
        uses: SonarSource/cfamily-s3-http-cache-proxy@v1
        with:
          s3-bucket: my-ccache-bucket
          s3-prefix: ccache/
          proxy-port: 8080

      - name: Install ccache
        run: |
          sudo apt-get update
          sudo apt-get install -y ccache

      - name: Configure ccache
        run: |
          ccache --set-config=remote_storage="http://localhost:8080"
          ccache --set-config=max_size=5G
          ccache --show-config

      - name: Build project
        run: |
          export CC="ccache gcc"
          export CXX="ccache g++"
          make -j$(nproc)

      - name: Show ccache statistics
        run: ccache --show-stats
```

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `s3-bucket` | S3 bucket name for cache storage | Yes | - |
| `s3-prefix` | S3 key prefix for cache objects | No | `ccache/` |
| `proxy-port` | Port for the HTTP proxy server | No | `8080` |
| `aws-region` | AWS region | No | `us-east-1` |

## Outputs

| Output | Description |
|--------|-------------|
| `proxy-url` | URL of the running proxy server (e.g., `http://localhost:8080`) |
| `proxy-pid` | Process ID of the proxy server |

## Prerequisites

- AWS credentials must be configured before using this action
- The specified S3 bucket must exist and be accessible
- The GitHub Actions runner must have network access to AWS S3

## How it works

1. Installs mise for tool version management
2. Uses mise to install Python 3.11 and Poetry 2.2.1
3. Installs the Python proxy package and its dependencies
4. Starts the HTTP proxy server in the background
5. The proxy translates HTTP GET/POST requests to S3 operations
6. ccache uses the proxy as its remote storage backend
7. The proxy runs until the workflow completes (no manual cleanup needed)

## S3 Bucket Setup

Create an S3 bucket for your ccache storage:

```bash
aws s3 mb s3://my-ccache-bucket
```

Ensure your AWS credentials have the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::my-ccache-bucket/*"
    }
  ]
}
```

## Development

### Running tests locally

```bash
# Install dependencies
poetry install

# Run tests
poetry run pytest

# Run tests with coverage
poetry run pytest --cov=ccache_s3_proxy --cov-report=term-missing
```

### Running the proxy locally

```bash
export S3_BUCKET=my-bucket
export S3_PREFIX=ccache/
export PROXY_PORT=8080

poetry run ccache-s3-proxy
```

## License

MIT

## Author

Sonar CFamily
