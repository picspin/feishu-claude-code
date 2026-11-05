import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../config.js';
import { getTelegramBridgeState, getTelegramChannel, getTelegramLastMessageType, telegramConfigError, writeTelegramRuntimeStatus } from './runtime.js';

process.env.FEISHU_CLAUDE_CODE_RUNTIME_DIR = join(tmpdir(), `dardanus-telegram-runtime-test-${process.pid}`);

test('recognizes ready Telegram polling config', () => {
  const config: Config = {
    port: 8787,
    webhookPath: '/feishu/webhook',
    workingDirectory: '/tmp',
    activeChannel: 'telegram',
    channels: {
      telegram: {
        status: 'ready',
        bridge: 'claude-code',
        login: 'polling',
        mode: 'polling',
        botToken: '123456:ABC',
      },
    },
  };

  assert.equal(getTelegramChannel(config)?.botToken, '123456:ABC');
  assert.equal(telegramConfigError(config), null);
});

test('requires bot token for Telegram polling', () => {
  const config: Config = {
    port: 8787,
    webhookPath: '/feishu/webhook',
    workingDirectory: '/tmp',
    activeChannel: 'telegram',
    channels: {
      telegram: {
        status: 'ready',
        bridge: 'claude-code',
        login: 'polling',
        mode: 'polling',
      },
    },
  };

  assert.equal(telegramConfigError(config), 'Telegram bot token is missing');
});

test('treats fresh Telegram polling status as online', () => {
  const now = new Date('2026-07-15T00:01:00.000Z');
  writeTelegramRuntimeStatus({
    channel: 'telegram',
    state: 'polling',
    updatedAt: '2026-07-15T00:00:00.000Z',
  });

  assert.equal(getTelegramBridgeState(now), 'online');
});

test('exposes Telegram non-text message type for the desktop pet', () => {
  writeTelegramRuntimeStatus({
    channel: 'telegram',
    state: 'processing',
    updatedAt: '2026-07-15T00:00:00.000Z',
    lastMessageType: 'audio',
  });

  assert.equal(getTelegramLastMessageType(), 'audio');
});

test('treats stale Telegram polling status as offline', () => {
  const now = new Date('2026-07-15T00:02:00.000Z');
  writeTelegramRuntimeStatus({
    channel: 'telegram',
    state: 'polling',
    updatedAt: '2026-07-15T00:00:00.000Z',
  });

  assert.equal(getTelegramBridgeState(now), 'offline');
});
