#!/bin/bash

set -euo pipefail

VAULT_URL=https://vault.sonar.build
VAULT_AUTH_PATH=jwt-ghwf

REPO_NAME=$(echo "${GITHUB_REPOSITORY}" | tr '/' '-')

VAULT_ROLE=github-${REPO_NAME}

GITHUB_OIDC_TOKEN=$(curl -H "Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" "${ACTIONS_ID_TOKEN_REQUEST_URL}"  -H "Accept: application/json; api-version=2.0" -H "Content-Type: application/json" -d "{}" | jq -r '.value')

export VAULT_TOKEN=$(curl -s -X PUT -H "X-Vault-Request: true" -d "{\"jwt\":\"${GITHUB_OIDC_TOKEN}\",\"role\":\"${VAULT_ROLE}\"}" ${VAULT_URL}/v1/auth/${VAULT_AUTH_PATH}/login | jq -r .auth.client_token)
export $(printf "AWS_ACCESS_KEY_ID=%s AWS_SECRET_ACCESS_KEY=%s AWS_SESSION_TOKEN=%s" \
  $(curl -s -H "X-Vault-Request: true" -H "X-Vault-Token: ${VAULT_TOKEN}" "${VAULT_URL}/v1/development/aws/sts/languages_team_analytics_dev" |
    jq -rc '.data|(.access_key,.secret_key,.security_token)' | tr -d '\r'))
