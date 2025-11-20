"""Tests for S3CacheHandler."""

from io import BytesIO
from unittest.mock import MagicMock, Mock

import pytest
from botocore.exceptions import ClientError

from ccache_s3_proxy.handler import S3CacheHandler


@pytest.fixture
def handler():
    """Create a handler with mocked S3 client."""
    mock_s3_client = MagicMock()
    mock_request = Mock()
    mock_client_address = ("127.0.0.1", 12345)
    mock_server = Mock()

    # Create handler class
    handler_class = type(
        "TestHandler",
        (S3CacheHandler,),
        {
            "s3_client": mock_s3_client,
            "s3_bucket": "test-bucket",
            "s3_prefix": "test/",
        },
    )

    # Mock the request/response infrastructure
    handler_instance = handler_class.__new__(handler_class)
    handler_instance.rfile = BytesIO()
    handler_instance.wfile = BytesIO()
    handler_instance.request = mock_request
    handler_instance.client_address = mock_client_address
    handler_instance.server = mock_server
    handler_instance.path = "/"
    handler_instance.headers = {}

    return handler_instance


def test_do_get_success(handler):
    """Test successful GET request."""
    handler.path = "/test-object"

    # Mock S3 response
    mock_response = {"Body": BytesIO(b"test data")}
    handler.s3_client.get_object.return_value = mock_response

    # Mock HTTP response methods
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    handler.do_GET()

    handler.s3_client.get_object.assert_called_once_with(
        Bucket="test-bucket", Key="test/test-object"
    )
    handler.send_response.assert_called_once_with(200)
    assert handler.wfile.getvalue() == b"test data"


def test_do_get_not_found(handler):
    """Test GET request for non-existent object."""
    handler.path = "/nonexistent"

    # Mock S3 NoSuchKey error
    error_response = {"Error": {"Code": "NoSuchKey"}}
    handler.s3_client.get_object.side_effect = ClientError(
        error_response, "GetObject"
    )

    handler.send_response = MagicMock()
    handler.end_headers = MagicMock()

    handler.do_GET()

    handler.send_response.assert_called_once_with(404)


def test_do_put_success(handler):
    """Test successful PUT request."""
    handler.path = "/test-object"
    test_data = b"test cache data"
    handler.rfile = BytesIO(test_data)
    handler.headers = {"Content-Length": str(len(test_data))}

    handler.send_response = MagicMock()
    handler.end_headers = MagicMock()

    handler.do_PUT()

    handler.s3_client.put_object.assert_called_once()
    call_kwargs = handler.s3_client.put_object.call_args[1]
    assert call_kwargs["Bucket"] == "test-bucket"
    assert call_kwargs["Key"] == "test/test-object"
    assert call_kwargs["Body"] == test_data
    handler.send_response.assert_called_once_with(201)


def test_do_head_success(handler):
    """Test successful HEAD request."""
    handler.path = "/test-object"

    # Mock S3 head_object response
    mock_response = {"ContentLength": 1234}
    handler.s3_client.head_object.return_value = mock_response

    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    handler.do_HEAD()

    handler.s3_client.head_object.assert_called_once_with(
        Bucket="test-bucket", Key="test/test-object"
    )
    handler.send_response.assert_called_once_with(200)
    handler.send_header.assert_any_call("Content-Type", "application/octet-stream")
    handler.send_header.assert_any_call("Content-Length", "1234")


def test_do_head_not_found(handler):
    """Test HEAD request for non-existent object."""
    handler.path = "/nonexistent"

    # Mock S3 404 error
    error_response = {"Error": {"Code": "404"}}
    handler.s3_client.head_object.side_effect = ClientError(
        error_response, "HeadObject"
    )

    handler.send_response = MagicMock()
    handler.end_headers = MagicMock()

    handler.do_HEAD()

    handler.send_response.assert_called_once_with(404)


def test_do_delete_success(handler):
    """Test successful DELETE request."""
    handler.path = "/test-object"

    handler.send_response = MagicMock()
    handler.end_headers = MagicMock()

    handler.do_DELETE()

    handler.s3_client.delete_object.assert_called_once_with(
        Bucket="test-bucket", Key="test/test-object"
    )
    handler.send_response.assert_called_once_with(204)


def test_do_delete_error(handler):
    """Test DELETE request with S3 error."""
    handler.path = "/test-object"

    # Mock S3 error
    handler.s3_client.delete_object.side_effect = Exception("S3 error")

    handler.send_response = MagicMock()
    handler.end_headers = MagicMock()

    handler.do_DELETE()

    handler.send_response.assert_called_once_with(500)
