#!/bin/bash
set -euo pipefail

DATA_DIR="${HOME}/.feishu-claude-code"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="feishu-claude-code"
OS_TYPE="$(uname -s)"
ENV_FILE="${HOME}/.config/cc_all_in/environment"

load_env_file() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
}

cloudflared_status() {
  if pgrep -f "cloudflared.*${PROJECT_DIR}" >/dev/null 2>&1 || pgrep -f "cloudflared" >/dev/null 2>&1; then
    echo "cloudflared: running"
  else
    echo "cloudflared: not running"
  fi
}

macos_plist_label() {
  echo "com.feishu-claude-code.bridge"
}

macos_plist_path() {
  echo "${HOME}/Library/LaunchAgents/$(macos_plist_label).plist"
}

macos_is_loaded() {
  launchctl print "gui/$(id -u)/$(macos_plist_label)" &>/dev/null
}

macos_start() {
  local plist_label="$(macos_plist_label)"
  local plist_path="$(macos_plist_path)"
  local node_bin="$(command -v node || echo '/usr/local/bin/node')"

  if macos_is_loaded; then
    echo "Already running"
    cloudflared_status
    exit 0
  fi

  mkdir -p "$DATA_DIR/logs"
  load_env_file

  cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plist_label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_bin}</string>
    <string>${PROJECT_DIR}/dist/main.js</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${DATA_DIR}/logs/stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${DATA_DIR}/logs/stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${HOME}/.local/bin:${node_bin%/*}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>FEISHU_APP_ID</key>
    <string>${FEISHU_APP_ID:-}</string>
    <key>FEISHU_APP_SECRET</key>
    <string>${FEISHU_APP_SECRET:-}</string>
    <key>FEISHU_VERIFICATION_TOKEN</key>
    <string>${FEISHU_VERIFICATION_TOKEN:-}</string>
    <key>FEISHU_ENCRYPT_KEY</key>
    <string>${FEISHU_ENCRYPT_KEY:-}</string>
    <key>FEISHU_PUBLIC_BASE_URL</key>
    <string>${FEISHU_PUBLIC_BASE_URL:-}</string>
  </dict>
</dict>
</plist>
PLIST

  launchctl load "$plist_path"
  echo "Started feishu-claude-code daemon"
  cloudflared_status
}

macos_stop() {
  local plist_label="$(macos_plist_label)"
  local plist_path="$(macos_plist_path)"
  launchctl bootout "gui/$(id -u)/${plist_label}" 2>/dev/null || true
  rm -f "$plist_path"
  echo "Stopped feishu-claude-code daemon"
}

macos_status() {
  if macos_is_loaded; then
    local pid=$(pgrep -f "dist/main.js start" 2>/dev/null | head -1)
    if [ -n "$pid" ]; then
      echo "Running (PID: $pid)"
    else
      echo "Loaded but not running"
    fi
  else
    echo "Not running"
  fi
  cloudflared_status
}

macos_logs() {
  for f in "${DATA_DIR}/logs/stdout.log" "${DATA_DIR}/logs/stderr.log"; do
    if [ -f "$f" ]; then
      echo "=== $(basename "$f") ==="
      tail -30 "$f"
    fi
  done
}

linux_pid_file() {
  echo "${DATA_DIR}/${SERVICE_NAME}.pid"
}

linux_start() {
  local pid_file="$(linux_pid_file)"
  local node_bin="$(command -v node || echo '/usr/bin/node')"

  if [ -f "$pid_file" ]; then
    local old_pid=$(cat "$pid_file" 2>/dev/null)
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      echo "Already running (PID: $old_pid)"
      cloudflared_status
      exit 0
    fi
    rm -f "$pid_file"
  fi

  mkdir -p "$DATA_DIR/logs"
  load_env_file
  nohup env \
    FEISHU_APP_ID="${FEISHU_APP_ID:-}" \
    FEISHU_APP_SECRET="${FEISHU_APP_SECRET:-}" \
    FEISHU_VERIFICATION_TOKEN="${FEISHU_VERIFICATION_TOKEN:-}" \
    FEISHU_ENCRYPT_KEY="${FEISHU_ENCRYPT_KEY:-}" \
    FEISHU_PUBLIC_BASE_URL="${FEISHU_PUBLIC_BASE_URL:-}" \
    "$node_bin" "${PROJECT_DIR}/dist/main.js" start >> "$DATA_DIR/logs/stdout.log" 2>> "$DATA_DIR/logs/stderr.log" &
  echo $! > "$pid_file"
  echo "Started feishu-claude-code daemon (PID: $!)"
  cloudflared_status
}

linux_stop() {
  local pid_file="$(linux_pid_file)"
  if [ -f "$pid_file" ]; then
    local pid=$(cat "$pid_file")
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file"
  fi
  echo "Stopped feishu-claude-code daemon"
}

linux_status() {
  local pid_file="$(linux_pid_file)"
  if [ -f "$pid_file" ]; then
    local pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      echo "Running (PID: $pid)"
    else
      echo "Not running"
    fi
  else
    echo "Not running"
  fi
  cloudflared_status
}

linux_logs() {
  for f in "${DATA_DIR}/logs/stdout.log" "${DATA_DIR}/logs/stderr.log"; do
    if [ -f "$f" ]; then
      echo "=== $(basename "$f") ==="
      tail -30 "$f"
    fi
  done
}

ACTION="${1:-status}"
case "$OS_TYPE" in
  Darwin)
    case "$ACTION" in
      start) macos_start ;;
      stop) macos_stop ;;
      restart) macos_stop; macos_start ;;
      status) macos_status ;;
      logs) macos_logs ;;
      *) echo "Usage: $0 {start|stop|restart|status|logs}"; exit 1 ;;
    esac
    ;;
  *)
    case "$ACTION" in
      start) linux_start ;;
      stop) linux_stop ;;
      restart) linux_stop; linux_start ;;
      status) linux_status ;;
      logs) linux_logs ;;
      *) echo "Usage: $0 {start|stop|restart|status|logs}"; exit 1 ;;
    esac
    ;;
esac
