#!/bin/bash
set -euo pipefail

DATA_DIR="${HOME}/.feishu-claude-code"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_NAME="feishu-claude-code"
OS_TYPE="$(uname -s)"
ENV_FILE="${HOME}/.config/cc_all_in/environment"
TUNNEL_SCRIPT="${PROJECT_DIR}/scripts/cloudflared-tunnel.sh"
RUN_WITH_TUNNEL_SCRIPT="${PROJECT_DIR}/scripts/run-with-tunnel.sh"
CLOUDFLARED_RUN_SCRIPT="${PROJECT_DIR}/scripts/cloudflared-run.sh"

load_env_file() {
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_FILE"
    set +a
  fi
}

cloudflared_status() {
  if [ -x "$TUNNEL_SCRIPT" ]; then
    "$TUNNEL_SCRIPT" status
  elif pgrep -f "cloudflared" >/dev/null 2>&1; then
    echo "cloudflared tunnel: running"
  else
    echo "cloudflared tunnel: not running"
  fi
}

cloudflared_stop() {
  if [ -x "$TUNNEL_SCRIPT" ]; then
    "$TUNNEL_SCRIPT" stop
  fi
}

bridge_stop_orphans() {
  local bridge_pid
  bridge_pid="$(lsof -tiTCP:8787 -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$bridge_pid" ]; then
    kill $bridge_pid 2>/dev/null || true
  fi
}

macos_plist_label() {
  echo "com.feishu-claude-code.bridge"
}

macos_plist_path() {
  echo "${HOME}/Library/LaunchAgents/$(macos_plist_label).plist"
}

macos_pid_file() {
  echo "${DATA_DIR}/${SERVICE_NAME}.pid"
}

macos_launchd_dir() {
  echo "${DATA_DIR}/launchd"
}

macos_bridge_label() {
  echo "com.feishu-claude-code.bridge"
}

macos_tunnel_label() {
  echo "com.feishu-claude-code.cloudflared"
}

macos_bridge_plist_path() {
  echo "$(macos_launchd_dir)/$(macos_bridge_label).plist"
}

macos_tunnel_plist_path() {
  echo "$(macos_launchd_dir)/$(macos_tunnel_label).plist"
}

macos_is_loaded() {
  launchctl print "gui/$(id -u)/$(macos_bridge_label)" &>/dev/null
}

macos_start() {
  local node_bin="$(command -v node || echo '/usr/local/bin/node')"
  local launchd_dir="$(macos_launchd_dir)"
  local bridge_label="$(macos_bridge_label)"
  local tunnel_label="$(macos_tunnel_label)"
  local bridge_plist="$(macos_bridge_plist_path)"
  local tunnel_plist="$(macos_tunnel_plist_path)"

  mkdir -p "$DATA_DIR/logs" "$launchd_dir"
  load_env_file
  bridge_stop_orphans
  cloudflared_stop

  launchctl bootout "gui/$(id -u)/${bridge_label}" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/${tunnel_label}" 2>/dev/null || true

  cat > "$tunnel_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${tunnel_label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${CLOUDFLARED_RUN_SCRIPT}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${DATA_DIR}/logs/cloudflared.log</string>
  <key>StandardErrorPath</key>
  <string>${DATA_DIR}/logs/cloudflared.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${HOME}/.local/bin:${node_bin%/*}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
PLIST

  cat > "$bridge_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${bridge_label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_bin}</string>
    <string>${PROJECT_DIR}/dist/main.js</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
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
    <key>FEISHU_AUDIO_TRANSCRIPTION_COMMAND</key>
    <string>${FEISHU_AUDIO_TRANSCRIPTION_COMMAND:-}</string>
  </dict>
</dict>
</plist>
PLIST

  launchctl bootstrap "gui/$(id -u)" "$tunnel_plist"
  launchctl bootstrap "gui/$(id -u)" "$bridge_plist"
  echo "Started feishu-claude-code daemon"
  cloudflared_status
}

macos_stop() {
  local plist_path="$(macos_plist_path)"
  launchctl bootout "gui/$(id -u)/$(macos_bridge_label)" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/$(macos_tunnel_label)" 2>/dev/null || true
  rm -f "$plist_path"
  rm -f "$(macos_bridge_plist_path)" "$(macos_tunnel_plist_path)"
  cloudflared_stop
  bridge_stop_orphans
  echo "Stopped feishu-claude-code daemon"
}

macos_status() {
  if macos_is_loaded; then
    echo "Running"
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
  if [ -f "${DATA_DIR}/logs/cloudflared.log" ]; then
    echo "=== cloudflared.log ==="
    tail -30 "${DATA_DIR}/logs/cloudflared.log"
  fi
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
    FEISHU_AUDIO_TRANSCRIPTION_COMMAND="${FEISHU_AUDIO_TRANSCRIPTION_COMMAND:-}" \
    NODE_BIN="$node_bin" \
    "$RUN_WITH_TUNNEL_SCRIPT" >> "$DATA_DIR/logs/stdout.log" 2>> "$DATA_DIR/logs/stderr.log" &
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
  cloudflared_stop
  bridge_stop_orphans
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
  if [ -f "${DATA_DIR}/logs/cloudflared.log" ]; then
    echo "=== cloudflared.log ==="
    tail -30 "${DATA_DIR}/logs/cloudflared.log"
  fi
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
