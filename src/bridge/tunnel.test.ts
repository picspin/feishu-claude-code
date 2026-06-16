import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { execFileSync } from 'node:child_process';
import { detectTunnelState } from './tunnel.js';

type ExecFileSync = typeof execFileSync;

test('reports tunnel online when cloudflared is listening on the local ingress port', () => {
  const exec = fakeExec(({ file, args }) => {
    if (file === 'lsof' && args.join(' ') === '-tiTCP:20241 -sTCP:LISTEN') {
      return '12345\n';
    }
    throw new Error('unexpected command');
  });

  assert.equal(detectTunnelState(exec), 'online');
});

test('falls back to process detection when the ingress port probe is unavailable', () => {
  const calls: string[] = [];
  const exec = fakeExec(({ file, args }) => {
    calls.push(`${file} ${args.join(' ')}`);
    if (file === 'pgrep' && args.join(' ') === '-f cloudflared.*tunnel run') {
      return '23456\n';
    }
    throw new Error('not found');
  });

  assert.equal(detectTunnelState(exec), 'online');
  assert.deepEqual(calls, [
    'lsof -tiTCP:20241 -sTCP:LISTEN',
    'pgrep -f cloudflared.*tunnel run',
  ]);
});

test('detects cloudflared even when the launch command does not include tunnel run', () => {
  const calls: string[] = [];
  const exec = fakeExec(({ file, args }) => {
    calls.push(`${file} ${args.join(' ')}`);
    if (file === 'pgrep' && args.join(' ') === '-f cloudflared') {
      return '34567\n';
    }
    throw new Error('not found');
  });

  assert.equal(detectTunnelState(exec), 'online');
  assert.deepEqual(calls, [
    'lsof -tiTCP:20241 -sTCP:LISTEN',
    'pgrep -f cloudflared.*tunnel run',
    'pgrep -f cloudflared',
  ]);
});

test('reports tunnel offline when neither port nor process probes succeed', () => {
  const exec = fakeExec(() => {
    throw new Error('not found');
  });

  assert.equal(detectTunnelState(exec), 'offline');
});

function fakeExec(handler: (command: { file: string; args: string[] }) => string): ExecFileSync {
  return ((file: string, args?: readonly string[]) => handler({ file, args: [...(args ?? [])] })) as ExecFileSync;
}
