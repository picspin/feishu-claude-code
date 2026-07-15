import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../config.js';
import { getWeComBridgeState, getWeComChannel, getWeComLastMessageType, weComConfigError, writeWeComRuntimeStatus } from './runtime.js';

process.env.FEISHU_CLAUDE_CODE_RUNTIME_DIR = join(tmpdir(), `dardanus-wecom-runtime-test-${process.pid}`);

test('recognizes ready WeCom long-connection config', () => {
  const config: Config = {
    port: 8787,
    webhookPath: '/feishu/webhook',
    workingDirectory: '/tmp',
    activeChannel: 'wecom',
    channels: {
      wecom: {
        status: 'ready',
        bridge: 'claude-code',
        login: 'long_connection',
        botId: 'BOTID',
        secret: 'SECRET',
      },
    },
  };

  assert.equal(getWeComChannel(config)?.botId, 'BOTID');
  assert.equal(weComConfigError(config), null);
});

test('requires BotID and Secret for WeCom long connection', () => {
  const config: Config = {
    port: 8787,
    webhookPath: '/feishu/webhook',
    workingDirectory: '/tmp',
    activeChannel: 'wecom',
    channels: {
      wecom: {
        status: 'ready',
        bridge: 'claude-code',
        login: 'long_connection',
        botId: 'BOTID',
      },
    },
  };

  assert.equal(weComConfigError(config), 'WeCom BotID or Secret is missing');
});

test('treats fresh subscribed runtime status as online', () => {
  const now = new Date('2026-07-07T00:00:30.000Z');
  writeWeComRuntimeStatus({
    channel: 'wecom',
    state: 'subscribed',
    updatedAt: '2026-07-07T00:00:00.000Z',
    botId: 'BOTID',
  });

  assert.equal(getWeComBridgeState(now), 'online');
});

test('exposes WeCom non-text message type for the desktop pet', () => {
  writeWeComRuntimeStatus({
    channel: 'wecom',
    state: 'processing',
    updatedAt: '2026-07-07T00:00:00.000Z',
    botId: 'BOTID',
    lastMessageType: 'image',
  });

  assert.equal(getWeComLastMessageType(), 'image');
});

test('treats stale runtime status as offline', () => {
  const now = new Date('2026-07-07T00:01:00.000Z');
  writeWeComRuntimeStatus({
    channel: 'wecom',
    state: 'subscribed',
    updatedAt: '2026-07-07T00:00:00.000Z',
    botId: 'BOTID',
  });

  assert.equal(getWeComBridgeState(now), 'offline');
});
