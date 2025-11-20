"""S3 HTTP Cache Proxy server."""

import logging
import os
import socketserver
from typing import Type

import boto3

from .handler import S3CacheHandler

logger = logging.getLogger(__name__)


def create_handler_class(
    s3_client: any, s3_bucket: str, s3_prefix: str
) -> Type[S3CacheHandler]:
    """Create a handler class with S3 configuration."""

    class ConfiguredHandler(S3CacheHandler):
        pass

    ConfiguredHandler.s3_client = s3_client
    ConfiguredHandler.s3_bucket = s3_bucket
    ConfiguredHandler.s3_prefix = s3_prefix

    return ConfiguredHandler


def run_server(
    port: int = 8080,
    s3_bucket: str = "ccache-storage",
    s3_prefix: str = "ccache/",
    s3_client: any = None,
) -> None:
    """Run the S3 cache proxy server.

    Args:
        port: Port to listen on
        s3_bucket: S3 bucket name
        s3_prefix: S3 key prefix for cache objects
        s3_client: Optional boto3 S3 client (for testing)
    """
    if s3_client is None:
        s3_client = boto3.client("s3")

    handler_class = create_handler_class(s3_client, s3_bucket, s3_prefix)

    with socketserver.TCPServer(("", port), handler_class) as httpd:
        logger.info(f"S3 Cache Proxy running on port {port}")
        logger.info(f"S3 Bucket: {s3_bucket}, Prefix: {s3_prefix}")
        httpd.serve_forever()


def main() -> None:
    """Main entry point for the server."""
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )

    port = int(os.environ.get("PROXY_PORT", "8080"))
    s3_bucket = os.environ.get("S3_BUCKET", "ccache-storage")
    s3_prefix = os.environ.get("S3_PREFIX", "ccache/")

    logger.info("Starting ccache S3 HTTP Proxy")

    try:
        run_server(port=port, s3_bucket=s3_bucket, s3_prefix=s3_prefix)
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Server error: {e}")
        raise


if __name__ == "__main__":
    main()
