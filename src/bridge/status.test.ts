import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBridgeStatusTracker } from './status.js';

test('tracks bridge status and recent events for the crab pet contract', () => {
  const tracker = createBridgeStatusTracker({
    version: '0.1.0',
    getBridgeState: () => 'online',
    getTunnelState: () => 'online',
    now: () => new Date('2026-06-15T00:00:00.000Z'),
  });

  assert.deepEqual(tracker.getStatus(), {
    bridge: 'online',
    tunnel: 'online',
    claude: 'idle',
    lastMessageType: null,
    lastEventAt: null,
    lastError: null,
    version: '0.1.0',
  });

  tracker.recordMessageReceived('image', '收到一张图片。');
  tracker.recordClaudeStarted();
  tracker.recordClaudeCompleted();

  assert.deepEqual(tracker.getStatus(), {
    bridge: 'online',
    tunnel: 'online',
    claude: 'idle',
    lastMessageType: 'image',
    lastEventAt: '2026-06-15T00:00:00.000Z',
    lastError: null,
    version: '0.1.0',
  });

  assert.deepEqual(parseJsonl(tracker.getEventsJsonl()), [
    { type: 'message_received', messageType: 'image', summary: '收到一张图片。', at: '2026-06-15T00:00:00.000Z' },
    { type: 'claude_started', at: '2026-06-15T00:00:00.000Z' },
    { type: 'claude_completed', at: '2026-06-15T00:00:00.000Z' },
  ]);
});

test('records a short message summary for the desktop bubble', () => {
  const tracker = createBridgeStatusTracker({
    version: '0.1.0',
    getBridgeState: () => 'online',
    getTunnelState: () => 'online',
    now: () => new Date('2026-06-15T00:00:00.000Z'),
  });

  tracker.recordMessageReceived(
    'text',
    '请帮我检查一下今天的构建状态，然后把结果总结给我。'.repeat(8),
  );

  const event = tracker.getEvents()[0];
  assert.equal(event.type, 'message_received');
  assert.equal(event.messageType, 'text');
  assert.equal(event.at, '2026-06-15T00:00:00.000Z');
  assert.equal(event.summary?.endsWith('…'), true);
  assert.equal(event.summary?.length, 121);
  assert.deepEqual(event, {
    type: 'message_received',
    messageType: 'text',
    summary: event.summary,
    at: '2026-06-15T00:00:00.000Z',
  });
});

test('keeps the most recent 50 bridge events', () => {
  let tick = 0;
  const tracker = createBridgeStatusTracker({
    version: '0.1.0',
    getBridgeState: () => 'online',
    getTunnelState: () => 'offline',
    now: () => new Date(Date.UTC(2026, 5, 15, 0, 0, tick++)),
  });

  for (let index = 0; index < 55; index += 1) {
    tracker.recordMessageReceived(index % 2 === 0 ? 'text' : 'file');
  }

  const events = tracker.getEvents();
  assert.equal(events.length, 50);
  assert.deepEqual(events[0], {
    type: 'message_received',
    messageType: 'file',
    at: '2026-06-15T00:00:05.000Z',
  });
  assert.deepEqual(events.at(-1), {
    type: 'message_received',
    messageType: 'text',
    at: '2026-06-15T00:00:54.000Z',
  });
  assert.equal(tracker.getStatus().tunnel, 'offline');
});

test('reports bridge offline when Feishu reply readiness is unavailable', () => {
  const tracker = createBridgeStatusTracker({
    version: '0.1.0',
    getBridgeState: () => 'offline',
    getBridgeError: () => 'Feishu app credentials are missing',
    getTunnelState: () => 'online',
    now: () => new Date('2026-06-15T00:00:00.000Z'),
  });

  assert.deepEqual(tracker.getStatus(), {
    bridge: 'offline',
    tunnel: 'online',
    claude: 'idle',
    lastMessageType: null,
    lastEventAt: null,
    lastError: 'Feishu app credentials are missing',
    version: '0.1.0',
  });
});

function parseJsonl(value: string): unknown[] {
  return value.split('\n').map((line) => JSON.parse(line) as unknown);
}
