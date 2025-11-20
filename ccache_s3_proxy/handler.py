"""HTTP request handler for S3-backed cache storage."""

import http.server
import logging
from typing import Any

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


class S3CacheHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler that proxies ccache requests to S3."""

    s3_client: Any = None
    s3_bucket: str = ""
    s3_prefix: str = ""

    def do_GET(self) -> None:
        """Handle GET requests - retrieve cached objects from S3."""
        try:
            path = self.path.lstrip("/")
            s3_key = f"{self.s3_prefix}{path}"

            logger.info(f"GET request for {path} -> s3://{self.s3_bucket}/{s3_key}")

            response = self.s3_client.get_object(Bucket=self.s3_bucket, Key=s3_key)
            content = response["Body"].read()

            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

            logger.info(f"Successfully retrieved {len(content)} bytes")

        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                logger.warning(f"Object not found: {s3_key}")
                self.send_response(404)
                self.end_headers()
            else:
                logger.error(f"S3 error on GET: {e}")
                self.send_response(500)
                self.end_headers()
        except Exception as e:
            logger.error(f"Error on GET: {e}")
            self.send_response(500)
            self.end_headers()

    def do_PUT(self) -> None:
        """Handle PUT requests - store cached objects to S3."""
        try:
            content_length = int(self.headers["Content-Length"])
            content = self.rfile.read(content_length)

            path = self.path.lstrip("/")
            s3_key = f"{self.s3_prefix}{path}"

            logger.info(f"PUT request for {path} -> s3://{self.s3_bucket}/{s3_key}")

            self.s3_client.put_object(
                Bucket=self.s3_bucket,
                Key=s3_key,
                Body=content,
                ContentType="application/octet-stream",
            )

            self.send_response(201)
            self.end_headers()

            logger.info(f"Successfully stored {len(content)} bytes")

        except Exception as e:
            logger.error(f"Error on PUT: {e}")
            self.send_response(500)
            self.end_headers()

    def do_HEAD(self) -> None:
        """Handle HEAD requests - check if cached object exists in S3."""
        try:
            path = self.path.lstrip("/")
            s3_key = f"{self.s3_prefix}{path}"

            logger.info(f"HEAD request for {path} -> s3://{self.s3_bucket}/{s3_key}")

            response = self.s3_client.head_object(Bucket=self.s3_bucket, Key=s3_key)

            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(response["ContentLength"]))
            self.end_headers()

            logger.info(f"Object exists with size {response['ContentLength']} bytes")

        except ClientError as e:
            if e.response["Error"]["Code"] == "404":
                logger.warning(f"Object not found: {s3_key}")
                self.send_response(404)
                self.end_headers()
            else:
                logger.error(f"S3 error on HEAD: {e}")
                self.send_response(500)
                self.end_headers()
        except Exception as e:
            logger.error(f"Error on HEAD: {e}")
            self.send_response(500)
            self.end_headers()

    def do_DELETE(self) -> None:
        """Handle DELETE requests - remove cached objects from S3."""
        try:
            path = self.path.lstrip("/")
            s3_key = f"{self.s3_prefix}{path}"

            logger.info(f"DELETE request for {path} -> s3://{self.s3_bucket}/{s3_key}")

            self.s3_client.delete_object(Bucket=self.s3_bucket, Key=s3_key)

            self.send_response(204)
            self.end_headers()

            logger.info(f"Successfully deleted object")

        except Exception as e:
            logger.error(f"Error on DELETE: {e}")
            self.send_response(500)
            self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        """Override to use logger instead of stderr."""
        logger.info(f"{self.client_address[0]} - {format % args}")
