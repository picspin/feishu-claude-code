#!/bin/bash
set -euo pipefail

DATA_DIR="${HOME}/.feishu-claude-code"
ASR_DIR="${DATA_DIR}/asr"
MODEL_NAME="${WHISPER_MODEL_NAME:-ggml-base.bin}"
MODEL_URL="${WHISPER_MODEL_URL:-https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_NAME}}"
MODEL_PATH="${ASR_DIR}/${MODEL_NAME}"
ENV_FILE="${HOME}/.config/cc_all_in/environment"

ensure_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Installing $cmd via Homebrew..."
    brew install "$cmd"
  fi
}

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for setup-asr. Please install Homebrew first."
  exit 1
fi

mkdir -p "$ASR_DIR"
ensure_cmd ffmpeg
ensure_cmd whisper-cpp
ensure_cmd curl

if [ ! -f "$MODEL_PATH" ]; then
  echo "Downloading whisper model to $MODEL_PATH"
  curl -L "$MODEL_URL" -o "$MODEL_PATH"
else
  echo "Whisper model already exists at $MODEL_PATH"
fi

COMMAND="whisper-cpp -m ${MODEL_PATH} -f {file} -otxt -of /tmp/feishu-audio && cat /tmp/feishu-audio.txt"

echo
 echo "Add or update this environment variable:"
 echo "export FEISHU_AUDIO_TRANSCRIPTION_COMMAND=\"$COMMAND\""

if [ -f "$ENV_FILE" ]; then
  if grep -q '^FEISHU_AUDIO_TRANSCRIPTION_COMMAND=' "$ENV_FILE"; then
    python3 - <<'PY' "$ENV_FILE" "$COMMAND"
from pathlib import Path
import sys
path = Path(sys.argv[1])
command = sys.argv[2]
lines = path.read_text().splitlines()
out = []
replaced = False
for line in lines:
    if line.startswith('FEISHU_AUDIO_TRANSCRIPTION_COMMAND='):
        out.append(f'FEISHU_AUDIO_TRANSCRIPTION_COMMAND="{command}"')
        replaced = True
    else:
        out.append(line)
if not replaced:
    out.append(f'FEISHU_AUDIO_TRANSCRIPTION_COMMAND="{command}"')
path.write_text('\n'.join(out) + '\n')
PY
    echo "Updated $ENV_FILE"
  else
    printf '\nFEISHU_AUDIO_TRANSCRIPTION_COMMAND="%s"\n' "$COMMAND" >> "$ENV_FILE"
    echo "Appended FEISHU_AUDIO_TRANSCRIPTION_COMMAND to $ENV_FILE"
  fi
else
  echo "$ENV_FILE not found. Export the variable manually before starting the bridge."
fi

echo
 echo "Next steps:"
 echo "1. npm run build"
 echo "2. npm run setup"
 echo "3. npm run daemon -- restart"
