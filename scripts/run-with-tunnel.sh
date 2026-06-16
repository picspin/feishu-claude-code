#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${HOME}/.feishu-claude-code"
TOKEN_FILE="${DATA_DIR}/cloudflared-token"
LOG_FILE="${DATA_DIR}/logs/cloudflared.log"
PID_FILE="${DATA_DIR}/cloudflared.pid"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-$(command -v cloudflared || true)}"
NODE_BIN="${NODE_BIN:-$(command -v node || echo /usr/local/bin/node)}"

read_token() {
  if [ -n "${CLOUDFLARED_TUNNEL_TOKEN:-}" ]; then
    printf '%s' "$CLOUDFLARED_TUNNEL_TOKEN"
    return
  fi

  if [ ! -f "$TOKEN_FILE" ]; then
    echo "Missing tunnel token file: $TOKEN_FILE"
    exit 1
  fi

  tr -d '\n\r' < "$TOKEN_FILE"
}

if [ -z "$CLOUDFLARED_BIN" ]; then
  echo "cloudflared not found in PATH"
  exit 1
fi

mkdir -p "${DATA_DIR}/logs"
existing_tunnel_pid="$(lsof -tiTCP:20241 -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$existing_tunnel_pid" ]; then
  kill $existing_tunnel_pid 2>/dev/null || true
fi

token="$(read_token)"
"$CLOUDFLARED_BIN" tunnel run --token "$token" </dev/null >> "$LOG_FILE" 2>&1 &
CLOUDFLARED_PID=$!
echo "$CLOUDFLARED_PID" > "$PID_FILE"
echo "cloudflared tunnel: started (PID: $CLOUDFLARED_PID)"
sleep 2

exec "$NODE_BIN" "${PROJECT_DIR}/dist/main.js" start
