#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="restless-cell-49791922"
DEV_BRANCH_ID="br-floral-term-acgf82iv"
STAGE_BRANCH_ID="br-purple-mountain-ac27f6vb"
NEON_CLI_VERSION="2.23.0"
TARGET="${1:-}"
STAGE_ORIGIN="${2:-}"

fail() { echo "Auth provider hardening failed: $*" >&2; exit 1; }

[ -n "${IFARM_SECURITY_NEON_API_KEY:-}" ] || fail "missing dedicated IFARM_SECURITY_NEON_API_KEY"

case "$TARGET" in
  dev)
    BRANCH_ID="$DEV_BRANCH_ID"
    ;;
  stage)
    BRANCH_ID="$STAGE_BRANCH_ID"
    [ -n "$STAGE_ORIGIN" ] || fail "STAGE requires the real approved HTTPS origin"
    [[ "$STAGE_ORIGIN" =~ ^https://[^/]+$ ]] || fail "STAGE origin must be an HTTPS origin without path/trailing slash"
    [[ "$STAGE_ORIGIN" != *localhost* && "$STAGE_ORIGIN" != *127.0.0.1* ]] || fail "localhost is forbidden as STAGE origin"
    ;;
  prod|production|main)
    fail "PROD is explicitly forbidden in SEC-184"
    ;;
  *)
    fail "target must be dev or stage"
    ;;
esac

export NEON_API_KEY="$IFARM_SECURITY_NEON_API_KEY"

neon_cli() {
  npx --yes "neon@${NEON_CLI_VERSION}" "$@"
}

# Official Managed Better Auth settings. No internal neon_auth tables are edited.
neon_cli neon-auth config email-password update \
  --project-id "$PROJECT_ID" \
  --branch "$BRANCH_ID" \
  --enabled \
  --disable-sign-up \
  --require-email-verification \
  --email-verification-method otp \
  --send-verification-email-on-sign-in

if [ "$TARGET" = "stage" ]; then
  # Only trust an origin after the deployment actually exists and ownership is known.
  neon_cli neon-auth domain add "$STAGE_ORIGIN" --project-id "$PROJECT_ID" --branch "$BRANCH_ID"
  neon_cli neon-auth domain allow-localhost disable --project-id "$PROJECT_ID" --branch "$BRANCH_ID"
fi

# Safe post-change inspection; these commands do not print API keys or SMTP passwords.
neon_cli neon-auth config email-password get --project-id "$PROJECT_ID" --branch "$BRANCH_ID"
neon_cli neon-auth domain allow-localhost get --project-id "$PROJECT_ID" --branch "$BRANCH_ID"
neon_cli neon-auth domain list --project-id "$PROJECT_ID" --branch "$BRANCH_ID"
