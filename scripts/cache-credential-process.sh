#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# Parse CLI arguments (preferred — values baked into ~/.aws/config by action.yml).
# Falls back to environment variables for backward compatibility.
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pool-id)    POOL_ID="$2";                shift 2 ;;
    --account-id) AWS_ACCOUNT_ID="$2";         shift 2 ;;
    --provider)   IDENTITY_PROVIDER_NAME="$2"; shift 2 ;;
    --audience)   AUDIENCE="$2";               shift 2 ;;
    --region)     AWS_REGION="$2";             shift 2 ;;
    *) echo "::warning::Unknown argument: $1" >&2; shift ;;
  esac
done

: "${POOL_ID:?}" "${AWS_ACCOUNT_ID:?}" "${IDENTITY_PROVIDER_NAME:?}" "${AUDIENCE:?}" "${AWS_REGION:?}"

# Export so subprocesses (get-github-token.sh) can access AUDIENCE and AWS_REGION
export POOL_ID AWS_ACCOUNT_ID IDENTITY_PROVIDER_NAME AUDIENCE AWS_REGION

if ! command -v aws >/dev/null 2>&1; then
  echo "::error title=AWS CLI is required for credential_process"
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "::error title=jq is required for credential_process"
  exit 1
fi

ACCESS_TOKEN=$("$script_dir/get-github-token.sh")

AWS_EC2_METADATA_DISABLED=true
AWS_MAX_ATTEMPTS=3
AWS_RETRY_MODE=standard

identity_id=$(timeout 30s aws --no-sign-request cognito-identity get-id \
  --identity-pool-id "$POOL_ID" \
  --account-id "$AWS_ACCOUNT_ID" \
  --logins "{\"${IDENTITY_PROVIDER_NAME}\":\"${ACCESS_TOKEN}\"}" \
  --query 'IdentityId' --output text)

if [[ "$identity_id" == "null" || -z "$identity_id" ]]; then
  echo "::error title=Failed to obtain Identity ID from Cognito Identity Pool"
  exit 1
fi

aws_credentials=$(timeout 30s aws --no-sign-request cognito-identity get-credentials-for-identity \
  --identity-id "$identity_id" \
  --logins "{\"${IDENTITY_PROVIDER_NAME}\":\"${ACCESS_TOKEN}\"}")

access_key_id=$(echo "$aws_credentials" | jq -r ".Credentials.AccessKeyId")
secret_access_key=$(echo "$aws_credentials" | jq -r ".Credentials.SecretKey")
session_token=$(echo "$aws_credentials" | jq -r ".Credentials.SessionToken")
expiration=$(echo "$aws_credentials" | jq -r ".Credentials.Expiration")

if [[ "$access_key_id" == "null" || -z "$access_key_id" ]]; then
  echo "::error title=Failed to obtain AWS Access Key ID"
  exit 1
fi
if [[ "$secret_access_key" == "null" || -z "$secret_access_key" ]]; then
  echo "::error title=Failed to obtain AWS Secret Access Key"
  exit 1
fi
if [[ "$session_token" == "null" || -z "$session_token" ]]; then
  echo "::error title=Failed to obtain AWS Session Token"
  exit 1
fi

cat <<JSON
{
  "Version": 1,
  "AccessKeyId": "${access_key_id}",
  "SecretAccessKey": "${secret_access_key}",
  "SessionToken": "${session_token}",
  "Expiration": "${expiration}"
}
JSON
