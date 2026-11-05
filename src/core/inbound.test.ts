import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Config } from '../config.js';
import { createPermissionBroker } from '../permission.js';
import { createSessionStore } from '../session.js';
import { handleInboundTurn } from './inbound.js';

const config: Config = {
  port: 8787,
  webhookPath: '/feishu/webhook',
  workingDirectory: '/tmp',
  permissionMode: 'default',
};

test('permission approve reply resolves waiting session without calling Claude', async () => {
  const sessionStore = createSessionStore();
  const permissionBroker = createPermissionBroker();
  const sessionKey = `test-permission-${process.pid}-${Date.now()}`;
  const session = sessionStore.load(sessionKey);
  session.state = 'waiting_permission';
  sessionStore.save(sessionKey, session);

  const wait = permissionBroker.waitForApproval(sessionKey);
  const replies: string[] = [];
  const result = await handleInboundTurn({
    sessionKey,
    messageType: 'text',
    messageText: 'y',
    config,
    sessionStore,
    permissionBroker,
    reply: async (text) => {
      replies.push(text);
    },
    emitChannelEvents: false,
  });

  assert.equal(result.outcome, 'permission_resolved');
  assert.equal(await wait, true);
  assert.deepEqual(replies, ['已批准，继续执行。']);
});

test('slash help command replies without Claude', async () => {
  const sessionStore = createSessionStore();
  const permissionBroker = createPermissionBroker();
  const sessionKey = `test-help-${process.pid}-${Date.now()}`;
  const replies: string[] = [];

  const result = await handleInboundTurn({
    sessionKey,
    messageType: 'text',
    messageText: '/help',
    config,
    sessionStore,
    permissionBroker,
    reply: async (text) => {
      replies.push(text);
    },
    emitChannelEvents: false,
  });

  assert.equal(result.outcome, 'command');
  assert.match(replies[0] || '', /\/help/);
});
