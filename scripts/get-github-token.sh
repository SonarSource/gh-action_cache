#!/usr/bin/env bash
#
# GitHub Actions ID Token Retrieval with Exponential Backoff
#
# This script retrieves a GitHub Actions OIDC token with retry logic
# to handle transient network failures and timeout issues.
#
# Environment variables required:
#   - ACTIONS_ID_TOKEN_REQUEST_TOKEN: GitHub Actions token request token
#   - ACTIONS_ID_TOKEN_REQUEST_URL: GitHub Actions token request URL
#   - AUDIENCE: The audience for the token (e.g., cognito-identity.amazonaws.com)
#
# Exit codes:
#   0: Success - token retrieved and printed to stdout
#   1: Failure - unable to retrieve token after all retry attempts
#

set -euox pipefail

readonly MAX_ATTEMPTS=5
readonly INITIAL_TIMEOUT=10
readonly MAX_TIMEOUT=60


log_warning() {
  echo "::warning::$*" >&2
}

log_error() {
  echo "::error::$*" >&2
}

get_github_token() {
  local timeout=$INITIAL_TIMEOUT

  for attempt in $(seq 1 $MAX_ATTEMPTS); do
    local http_code
    local response
    response=$(curl -sLS \
      --connect-timeout 10 \
      --max-time "$timeout" \
      -w "\n%{http_code}" \
      -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
      "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=$AUDIENCE" 2>&1)
    local curl_exit=$?

    if [[ $curl_exit -eq 0 ]]; then
      http_code=$(echo "$response" | tail -n 1)
      local token

      echo "$response" > /tmp/response_debug.log
      local response_body
      response_body=$(echo "$response" | sed '$d')
      echo "$response_body" > /tmp/response_body_debug.log
      token=$(echo "$response_body" | jq -r ".value" 2>/tmp/jq_stderr.log)

      echo "$token" > /tmp/token_debug.log

      if [[ "$token" != "null" && -n "$token" ]]; then
        echo "$token"
        return 0
      fi
      log_warning "Attempt $attempt/$MAX_ATTEMPTS: Invalid token response (HTTP $http_code)"
    else
      case $curl_exit in
        6) log_warning "Attempt $attempt/$MAX_ATTEMPTS: Could not resolve host" ;;
        7) log_warning "Attempt $attempt/$MAX_ATTEMPTS: Failed to connect" ;;
        28) log_warning "Attempt $attempt/$MAX_ATTEMPTS: Operation timeout after ${timeout}s" ;;
        35) log_warning "Attempt $attempt/$MAX_ATTEMPTS: SSL/TLS handshake failed" ;;
        52) log_warning "Attempt $attempt/$MAX_ATTEMPTS: Empty response from server" ;;
        56) log_warning "Attempt $attempt/$MAX_ATTEMPTS: Network data receive failure" ;;
        *) log_warning "Attempt $attempt/$MAX_ATTEMPTS: Curl error $curl_exit" ;;
      esac
    fi

    # Exponential backoff with jitter
    if [[ $attempt -lt $MAX_ATTEMPTS ]]; then
      local base_wait=$((2 ** attempt))
      local jitter=$((RANDOM % 3))
      local wait_time=$((base_wait + jitter))
      log_warning "Retrying in ${wait_time}s..."
      sleep "$wait_time"

      timeout=$((timeout * 2))
      [[ $timeout -gt $MAX_TIMEOUT ]] && timeout=$MAX_TIMEOUT
    fi
  done

  return 1
}

main() {
  if [[ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]]; then
    log_error "ACTIONS_ID_TOKEN_REQUEST_TOKEN environment variable is not set"
    exit 1
  fi

  if [[ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ]]; then
    log_error "ACTIONS_ID_TOKEN_REQUEST_URL environment variable is not set"
    exit 1
  fi

  if [[ -z "${AUDIENCE:-}" ]]; then
    log_error "AUDIENCE environment variable is not set"
    exit 1
  fi

  local token
  if ! token=$(get_github_token); then
    log_error "Failed to obtain GitHub Actions ID token after $MAX_ATTEMPTS attempts"
    log_error "This may indicate network issues or GitHub Actions service problems"
    log_error "Check GitHub Actions status: https://www.githubstatus.com/"
    exit 1
  fi

  echo "$token"
}

main "$@"
