"""Tests for server module."""

from unittest.mock import MagicMock, patch

import pytest

from ccache_s3_proxy.handler import S3CacheHandler
from ccache_s3_proxy.server import create_handler_class


def test_create_handler_class():
    """Test creating a configured handler class."""
    mock_s3_client = MagicMock()
    bucket = "test-bucket"
    prefix = "test-prefix/"

    handler_class = create_handler_class(mock_s3_client, bucket, prefix)

    assert issubclass(handler_class, S3CacheHandler)
    assert handler_class.s3_client is mock_s3_client
    assert handler_class.s3_bucket == bucket
    assert handler_class.s3_prefix == prefix


def test_handler_class_configuration():
    """Test that handler class has correct configuration."""
    mock_s3_client = MagicMock()
    bucket = "my-bucket"
    prefix = "my-prefix/"

    handler_class = create_handler_class(mock_s3_client, bucket, prefix)

    # Check class attributes directly
    assert handler_class.s3_client is mock_s3_client
    assert handler_class.s3_bucket == bucket
    assert handler_class.s3_prefix == prefix
