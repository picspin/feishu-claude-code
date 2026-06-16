#!/bin/bash
set -euo pipefail

DATA_DIR="${HOME}/.feishu-claude-code"
TOKEN_FILE="${DATA_DIR}/cloudflared-token"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-$(command -v cloudflared || true)}"

if [ -z "$CLOUDFLARED_BIN" ]; then
  echo "cloudflared not found in PATH"
  exit 1
fi

if [ -n "${CLOUDFLARED_TUNNEL_TOKEN:-}" ]; then
  token="$CLOUDFLARED_TUNNEL_TOKEN"
elif [ -f "$TOKEN_FILE" ]; then
  token="$(tr -d '\n\r' < "$TOKEN_FILE")"
else
  echo "Missing tunnel token file: $TOKEN_FILE"
  exit 1
fi

exec "$CLOUDFLARED_BIN" tunnel run --token "$token"
