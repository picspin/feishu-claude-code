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

cloudflared_wait_until_running() {
  local attempts="${1:-10}"
  local i
  for ((i = 0; i < attempts; i++)); do
    if [ -x "$TUNNEL_SCRIPT" ] && "$TUNNEL_SCRIPT" status | grep -q "cloudflared tunnel: running"; then
      return 0
    fi
    if /usr/sbin/lsof -tiTCP:20241 -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

cloudflared_stop() {
  if [ -x "$TUNNEL_SCRIPT" ]; then
    "$TUNNEL_SCRIPT" stop
  fi
}

resolve_node_bin() {
  if [ -x "${NODE_BIN:-}" ]; then
    echo "$NODE_BIN"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  for candidate in \
    "${HOME}/.nvm/versions/node/v22.19.0/bin/node" \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node" \
    "/usr/bin/node"
  do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done
  echo ""
}

bridge_stop_orphans() {
  local bridge_pid
  bridge_pid="$(/usr/sbin/lsof -tiTCP:8787 -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$bridge_pid" ]; then
    kill $bridge_pid 2>/dev/null || true
  fi

  local stale_bridge_pids
  stale_bridge_pids="$(/usr/bin/pgrep -f "${PROJECT_DIR}/dist/main.js start" 2>/dev/null || true)"
  if [ -n "$stale_bridge_pids" ]; then
    kill $stale_bridge_pids 2>/dev/null || true
  fi
}

bridge_wait_until_stopped() {
  local attempts="${1:-10}"
  local i
  for ((i = 0; i < attempts; i++)); do
    if ! /usr/sbin/lsof -tiTCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

bridge_health_ok() {
  /usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:8787/health" >/dev/null 2>&1
}

bridge_wait_until_running() {
  local attempts="${1:-20}"
  local i
  for ((i = 0; i < attempts; i++)); do
    if bridge_health_ok; then
      return 0
    fi
    sleep 1
  done
  return 1
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

wecom_label() {
  echo "com.feishu-claude-code.wecom-long-connection"
}

macos_bridge_plist_path() {
  echo "$(macos_launchd_dir)/$(macos_bridge_label).plist"
}

macos_tunnel_plist_path() {
  echo "$(macos_launchd_dir)/$(macos_tunnel_label).plist"
}

wecom_plist_path() {
  echo "$(macos_launchd_dir)/$(wecom_label).plist"
}

wecom_pid_file() {
  echo "${DATA_DIR}/wecom-long-connection.pid"
}

wecom_is_configured() {
  local node_bin="$1"
  DATA_DIR="$DATA_DIR" "$node_bin" -e '
const fs = require("fs");
const path = require("path");
try {
  const config = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, "config.json"), "utf8"));
  const channel = config.channels && config.channels.wecom;
  process.exit(config.activeChannel === "wecom" && channel && channel.status === "ready" && channel.login === "long_connection" && channel.botId && channel.secret ? 0 : 1);
} catch {
  process.exit(1);
}
' >/dev/null 2>&1
}

wecom_stop_pid_file() {
  local pid_file="$(wecom_pid_file)"
  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
}

wecom_stop_orphans() {
  local stale_pids
  stale_pids="$(/usr/bin/pgrep -f "${PROJECT_DIR}/dist/wecom/long-connection.js" 2>/dev/null || true)"
  if [ -n "$stale_pids" ]; then
    kill $stale_pids 2>/dev/null || true
  fi
}

wecom_status() {
  local node_bin="$(resolve_node_bin)"
  if [ -z "$node_bin" ] || ! wecom_is_configured "$node_bin"; then
    echo "wecom long connection: not configured"
    return
  fi

  if launchctl print "gui/$(id -u)/$(wecom_label)" &>/dev/null || /usr/bin/pgrep -f "${PROJECT_DIR}/dist/wecom/long-connection.js" >/dev/null 2>&1; then
    echo "wecom long connection: running"
  else
    echo "wecom long connection: not running"
  fi
}

macos_is_loaded() {
  launchctl print "gui/$(id -u)/$(macos_bridge_label)" &>/dev/null
}

bridge_stop_pid_file() {
  local pid_file="$(macos_pid_file)"
  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
}

macos_bootstrap() {
  local label="$1"
  local plist="$2"
  local domain="gui/$(id -u)"
  local service="${domain}/${label}"
  local attempt

  for attempt in 1 2 3; do
    if launchctl bootstrap "$domain" "$plist"; then
      return 0
    fi
    if launchctl print "$service" &>/dev/null; then
      launchctl kickstart -k "$service" 2>/dev/null || true
      return 0
    fi
    sleep 1
  done

  launchctl bootstrap "$domain" "$plist"
}

macos_start() {
  local node_bin="$(resolve_node_bin)"
  local launchd_dir="$(macos_launchd_dir)"
  local tunnel_label="$(macos_tunnel_label)"
  local tunnel_plist="$(macos_tunnel_plist_path)"
  local wecom_service_label="$(wecom_label)"
  local wecom_plist="$(wecom_plist_path)"
  local pid_file="$(macos_pid_file)"

  if [ -z "$node_bin" ]; then
    echo "node not found. Install Node.js or set NODE_BIN to an executable node path."
    exit 1
  fi

  mkdir -p "$DATA_DIR/logs" "$launchd_dir"
  load_env_file

  launchctl bootout "gui/$(id -u)/${tunnel_label}" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/${wecom_service_label}" 2>/dev/null || true
  sleep 1
  launchctl bootout "gui/$(id -u)/$(macos_bridge_label)" 2>/dev/null || true
  bridge_stop_pid_file
  wecom_stop_pid_file
  bridge_stop_orphans
  wecom_stop_orphans
  bridge_wait_until_stopped 10 || true
  cloudflared_stop

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
    <string>${HOME}/.local/bin:${node_bin%/*}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST

  macos_bootstrap "$tunnel_label" "$tunnel_plist"
  if wecom_is_configured "$node_bin"; then
    cat > "$wecom_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${wecom_service_label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${node_bin}</string>
    <string>${PROJECT_DIR}/dist/wecom/long-connection.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${PROJECT_DIR}</string>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${DATA_DIR}/logs/wecom-long-connection.log</string>
  <key>StandardErrorPath</key>
  <string>${DATA_DIR}/logs/wecom-long-connection.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${HOME}/.local/bin:${node_bin%/*}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
PLIST
    macos_bootstrap "$wecom_service_label" "$wecom_plist"
  fi
  (
    cd "$PROJECT_DIR"
    nohup env \
      PATH="${HOME}/.local/bin:${node_bin%/*}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
      FEISHU_APP_ID="${FEISHU_APP_ID:-}" \
      FEISHU_APP_SECRET="${FEISHU_APP_SECRET:-}" \
      FEISHU_VERIFICATION_TOKEN="${FEISHU_VERIFICATION_TOKEN:-}" \
      FEISHU_ENCRYPT_KEY="${FEISHU_ENCRYPT_KEY:-}" \
      FEISHU_PUBLIC_BASE_URL="${FEISHU_PUBLIC_BASE_URL:-}" \
      FEISHU_AUDIO_TRANSCRIPTION_COMMAND="${FEISHU_AUDIO_TRANSCRIPTION_COMMAND:-}" \
      "$node_bin" "${PROJECT_DIR}/dist/main.js" start >> "${DATA_DIR}/logs/stdout.log" 2>> "${DATA_DIR}/logs/stderr.log" &
    echo $! > "$pid_file"
  )
  bridge_wait_until_running 60 || {
    echo "bridge did not become healthy on http://127.0.0.1:8787/health"
    exit 1
  }
  cloudflared_wait_until_running 30 || true
  echo "Started feishu-claude-code daemon"
  cloudflared_status
  wecom_status
}

macos_stop() {
  local plist_path="$(macos_plist_path)"
  launchctl bootout "gui/$(id -u)/$(macos_bridge_label)" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/$(macos_tunnel_label)" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/$(wecom_label)" 2>/dev/null || true
  rm -f "$plist_path"
  rm -f "$(macos_bridge_plist_path)" "$(macos_tunnel_plist_path)" "$(wecom_plist_path)"
  bridge_stop_pid_file
  wecom_stop_pid_file
  cloudflared_stop
  bridge_stop_orphans
  wecom_stop_orphans
  echo "Stopped feishu-claude-code daemon"
}

macos_status() {
  if bridge_health_ok; then
    echo "Running"
  else
    echo "Not running"
  fi
  cloudflared_status
  wecom_status
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
  if [ -f "${DATA_DIR}/logs/wecom-long-connection.log" ]; then
    echo "=== wecom-long-connection.log ==="
    tail -30 "${DATA_DIR}/logs/wecom-long-connection.log"
  fi
}

linux_pid_file() {
  echo "${DATA_DIR}/${SERVICE_NAME}.pid"
}

linux_start() {
  local pid_file="$(linux_pid_file)"
  local node_bin="$(resolve_node_bin)"

  if [ -z "$node_bin" ]; then
    echo "node not found. Install Node.js or set NODE_BIN to an executable node path."
    exit 1
  fi

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
  if wecom_is_configured "$node_bin"; then
    nohup env \
      PATH="${HOME}/.local/bin:${node_bin%/*}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
      "$node_bin" "${PROJECT_DIR}/dist/wecom/long-connection.js" >> "$DATA_DIR/logs/wecom-long-connection.log" 2>&1 &
    echo $! > "$(wecom_pid_file)"
  fi
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
  wecom_stop_pid_file
  bridge_stop_orphans
  wecom_stop_orphans
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
  wecom_status
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
  if [ -f "${DATA_DIR}/logs/wecom-long-connection.log" ]; then
    echo "=== wecom-long-connection.log ==="
    tail -30 "${DATA_DIR}/logs/wecom-long-connection.log"
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
