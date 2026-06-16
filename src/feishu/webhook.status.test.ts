import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createBridgeStatusTracker } from '../bridge/status.js';
import { createWebhookServer } from './webhook.js';

test('serves health, status, and recent events for the crab pet', async () => {
  const tracker = createBridgeStatusTracker({
    version: '0.1.0',
    getBridgeState: () => 'online',
    getTunnelState: () => 'online',
    now: () => new Date('2026-06-15T00:00:00.000Z'),
  });
  tracker.recordMessageReceived('audio', '收到一段音频。');

  const server = createWebhookServer({
    port: 0,
    path: '/feishu/webhook',
    statusTracker: tracker,
    onMessage: async () => undefined,
  });

  await server.listen();
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok', version: '0.1.0' });

    const status = await fetch(`${baseUrl}/status`);
    assert.equal(status.status, 200);
    assert.equal(status.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(await status.json(), {
      bridge: 'online',
      tunnel: 'online',
      claude: 'idle',
      lastMessageType: 'audio',
      lastEventAt: '2026-06-15T00:00:00.000Z',
      lastError: null,
      version: '0.1.0',
    });

    const events = await fetch(`${baseUrl}/events`);
    assert.equal(events.status, 200);
    assert.equal(events.headers.get('access-control-allow-origin'), '*');
    assert.deepEqual(JSON.parse(await events.text()), {
      type: 'message_received',
      messageType: 'audio',
      summary: '收到一段音频。',
      at: '2026-06-15T00:00:00.000Z',
    });

    const preflight = await fetch(`${baseUrl}/status`, { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  } finally {
    await server.close();
  }
});
