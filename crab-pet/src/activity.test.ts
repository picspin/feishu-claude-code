import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeCrabActivity } from './activity.js';

test('describes the latest non-text message in the bubble', () => {
  assert.equal(
    describeCrabActivity({
      state: 'wink',
      status: {
        bridge: 'online',
        tunnel: 'online',
        claude: 'idle',
        lastMessageType: 'image',
        lastEventAt: '2026-06-15T00:00:00.000Z',
        lastError: null,
      },
      events: [{ type: 'message_received', messageType: 'image', at: '2026-06-15T00:00:00.000Z' }],
    }),
    'Received image input',
  );
});

test('uses bridge-provided message summaries when present', () => {
  assert.equal(
    describeCrabActivity({
      state: 'bubbling',
      status: {
        bridge: 'online',
        tunnel: 'online',
        claude: 'idle',
        lastMessageType: 'text',
        lastEventAt: '2026-06-15T00:00:00.000Z',
        lastError: null,
      },
      events: [
        {
          type: 'message_received',
          messageType: 'text',
          summary: '帮我看一下最新构建状态',
          at: '2026-06-15T00:00:00.000Z',
        },
      ],
    }),
    '帮我看一下最新构建状态',
  );
});

test('describes reply completion before generic idle copy', () => {
  assert.equal(
    describeCrabActivity({
      state: 'bubbling',
      status: {
        bridge: 'online',
        tunnel: 'online',
        claude: 'idle',
        lastMessageType: 'text',
        lastEventAt: '2026-06-15T00:00:04.000Z',
        lastError: null,
      },
      events: [
        { type: 'message_received', messageType: 'text', at: '2026-06-15T00:00:00.000Z' },
        { type: 'claude_completed', at: '2026-06-15T00:00:04.000Z' },
      ],
    }),
    'Reply completed',
  );
});

test('describes offline and error details when available', () => {
  assert.equal(
    describeCrabActivity({
      state: 'sleep',
      status: {
        bridge: 'offline',
        tunnel: 'offline',
        claude: 'idle',
        lastMessageType: null,
        lastEventAt: null,
        lastError: 'Bridge unavailable',
      },
      events: [],
    }),
    'Bridge unavailable',
  );

  assert.equal(
    describeCrabActivity({
      state: 'sleep',
      status: {
        bridge: 'online',
        tunnel: 'online',
        claude: 'idle',
        lastMessageType: 'text',
        lastEventAt: '2026-06-15T00:00:04.000Z',
        lastError: 'Claude crashed',
      },
      events: [{ type: 'error', message: 'Claude crashed', at: '2026-06-15T00:00:04.000Z' }],
    }),
    'Claude crashed',
  );
});
