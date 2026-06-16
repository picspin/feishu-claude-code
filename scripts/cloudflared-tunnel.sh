#!/bin/bash
set -euo pipefail

DATA_DIR="${HOME}/.feishu-claude-code"
TOKEN_FILE="${DATA_DIR}/cloudflared-token"
LOG_FILE="${DATA_DIR}/logs/cloudflared.log"
PID_FILE="${DATA_DIR}/cloudflared.pid"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-$(command -v cloudflared || true)}"

usage() {
  cat <<USAGE
Usage: npm run tunnel -- <command>

Commands:
  start      Start cloudflared tunnel now
  stop       Stop cloudflared tunnel
  restart    Restart cloudflared tunnel
  status     Show tunnel status
  logs       Tail cloudflared logs

Token setup:
  Save your tunnel token to ${TOKEN_FILE}
  or run with CLOUDFLARED_TUNNEL_TOKEN in the environment.
USAGE
}

require_cloudflared() {
  if [ -z "$CLOUDFLARED_BIN" ]; then
    echo "cloudflared not found in PATH. Install it with Homebrew first."
    exit 1
  fi
}

read_token() {
  if [ -n "${CLOUDFLARED_TUNNEL_TOKEN:-}" ]; then
    printf '%s' "$CLOUDFLARED_TUNNEL_TOKEN"
    return
  fi

  if [ ! -f "$TOKEN_FILE" ]; then
    echo "Missing tunnel token file: $TOKEN_FILE"
    echo "Create it with: mkdir -p '$DATA_DIR' && printf '%s' '<token>' > '$TOKEN_FILE' && chmod 600 '$TOKEN_FILE'"
    exit 1
  fi

  tr -d '\n\r' < "$TOKEN_FILE"
}

is_running() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi

  lsof -tiTCP:20241 -sTCP:LISTEN >/dev/null 2>&1
}

start_tunnel() {
  require_cloudflared
  mkdir -p "${DATA_DIR}/logs"

  if is_running; then
    echo "cloudflared tunnel: running"
    return
  fi

  local token
  token="$(read_token)"
  nohup "$CLOUDFLARED_BIN" tunnel run --token "$token" </dev/null >> "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  local pid=$!
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    echo "cloudflared tunnel: started (PID: $pid)"
  else
    rm -f "$PID_FILE"
    echo "cloudflared tunnel: failed to stay running. Check $LOG_FILE"
    exit 1
  fi
}

stop_tunnel() {
  if [ -f "$PID_FILE" ]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi

  local metrics_pid
  metrics_pid="$(lsof -tiTCP:20241 -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$metrics_pid" ]; then
    kill $metrics_pid 2>/dev/null || true
  fi
  echo "cloudflared tunnel: stopped"
}

status_tunnel() {
  if is_running; then
    echo "cloudflared tunnel: running"
  else
    echo "cloudflared tunnel: not running"
  fi
}

logs_tunnel() {
  if [ -f "$LOG_FILE" ]; then
    tail -80 "$LOG_FILE"
  else
    echo "No log file yet: $LOG_FILE"
  fi
}

ACTION="${1:-status}"
case "$ACTION" in
  start) start_tunnel ;;
  stop) stop_tunnel ;;
  restart) stop_tunnel; start_tunnel ;;
  status) status_tunnel ;;
  logs) logs_tunnel ;;
  -h|--help|help) usage ;;
  *) usage; exit 1 ;;
esac
