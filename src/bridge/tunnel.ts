import { execFileSync } from 'node:child_process';
import type { BridgeOnlineState } from './status.js';

type ExecFileSync = typeof execFileSync;

export function detectTunnelState(exec: ExecFileSync = execFileSync): BridgeOnlineState {
  if (commandHasOutput(exec, '/usr/sbin/lsof', ['-tiTCP:20241', '-sTCP:LISTEN'])) {
    return 'online';
  }

  if (commandHasOutput(exec, '/usr/bin/pgrep', ['-f', 'cloudflared.*tunnel run'])) {
    return 'online';
  }

  if (commandHasOutput(exec, '/usr/bin/pgrep', ['-f', 'cloudflared'])) {
    return 'online';
  }

  return 'offline';
}

function commandHasOutput(exec: ExecFileSync, file: string, args: string[]): boolean {
  try {
    const output = exec(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 500,
    });
    return String(output).trim().length > 0;
  } catch {
    return false;
  }
}
