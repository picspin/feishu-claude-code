import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveCrabState } from './state.js';

test('sleeps when bridge or tunnel is offline', () => {
  assert.equal(
    deriveCrabState({
      status: {
        bridge: 'online',
        tunnel: 'offline',
        claude: 'idle',
        lastMessageType: 'text',
        lastEventAt: '2026-06-15T00:00:00.000Z',
        lastError: null,
      },
      events: [],
      now: new Date('2026-06-15T00:00:01.000Z'),
    }),
    'sleep',
  );
});

test('uses interaction effects before business activity', () => {
  assert.equal(
    deriveCrabState({
      status: {
        bridge: 'online',
        tunnel: 'online',
        claude: 'processing',
        lastMessageType: 'image',
        lastEventAt: '2026-06-15T00:00:00.000Z',
        lastError: null,
      },
      events: [{ type: 'message_received', messageType: 'image', at: '2026-06-15T00:00:00.000Z' }],
      interaction: 'dodge',
      now: new Date('2026-06-15T00:00:01.000Z'),
    }),
    'dodge',
  );
});

test('uses click-triggered crawl before idle wake state', () => {
  assert.equal(
    deriveCrabState({
      status: {
        bridge: 'online',
        tunnel: 'online',
        claude: 'idle',
        lastMessageType: 'text',
        lastEventAt: null,
        lastError: null,
      },
      events: [],
      interaction: 'crawl',
      now: new Date('2026-06-15T00:00:01.000Z'),
    }),
    'crawl',
  );
});

test('uses interaction effects before offline sleep state', () => {
  assert.equal(
    deriveCrabState({
      status: {
        bridge: 'online',
        tunnel: 'offline',
        claude: 'idle',
        lastMessageType: 'text',
        lastEventAt: null,
        lastError: null,
      },
      events: [],
      interaction: 'dodge',
      now: new Date('2026-06-15T00:00:01.000Z'),
    }),
    'dodge',
  );

  assert.equal(
    deriveCrabState({
      status: {
        bridge: 'offline',
        tunnel: 'offline',
        claude: 'idle',
        lastMessageType: 'text',
        lastEventAt: null,
        lastError: null,
      },
      events: [],
      interaction: 'shrink',
      now: new Date('2026-06-15T00:00:01.000Z'),
    }),
    'shrink',
  );
});

test('winks for recent non-text input before crawling', () => {
  assert.equal(
    deriveCrabState({
      status: {
        bridge: 'online',
        tunnel: 'online',
        claude: 'processing',
        lastMessageType: 'image',
        lastEventAt: '2026-06-15T00:00:00.000Z',
        lastError: null,
      },
      events: [{ type: 'message_received', messageType: 'image', at: '2026-06-15T00:00:00.000Z' }],
      now: new Date('2026-06-15T00:00:02.000Z'),
    }),
    'wink',
  );
});

test('crawls while Claude is processing when no higher priority state applies', () => {
  assert.equal(
    deriveCrabState({
      status: {
        bridge: 'online',
        tunnel: 'online',
        claude: 'processing',
        lastMessageType: 'text',
        lastEventAt: '2026-06-15T00:00:00.000Z',
        lastError: null,
      },
      events: [{ type: 'message_received', messageType: 'text', at: '2026-06-15T00:00:00.000Z' }],
      now: new Date('2026-06-15T00:00:02.000Z'),
    }),
    'crawl',
  );
});

test('bubbles for recent completion or explicit bubble request', () => {
  assert.equal(
    deriveCrabState({
      status: {
        bridge: 'online',
        tunnel: 'online',
        claude: 'idle',
        lastMessageType: 'text',
        lastEventAt: '2026-06-15T00:00:00.000Z',
        lastError: null,
      },
      events: [{ type: 'claude_completed', at: '2026-06-15T00:00:00.000Z' }],
      now: new Date('2026-06-15T00:00:03.000Z'),
    }),
    'bubbling',
  );

  assert.equal(
    deriveCrabState({
      status: {
        bridge: 'online',
        tunnel: 'online',
        claude: 'idle',
        lastMessageType: 'text',
        lastEventAt: null,
        lastError: null,
      },
      events: [],
      interaction: 'bubbling',
      now: new Date('2026-06-15T00:00:03.000Z'),
    }),
    'bubbling',
  );
});

test('stays awake without waving when Feishu phone side is healthy and idle', () => {
  assert.equal(
    deriveCrabState({
      status: {
        bridge: 'online',
        tunnel: 'online',
        claude: 'idle',
        lastMessageType: 'text',
        lastEventAt: null,
        lastError: null,
      },
      events: [],
      now: new Date('2026-06-15T00:00:03.000Z'),
    }),
    'awake',
  );
});
