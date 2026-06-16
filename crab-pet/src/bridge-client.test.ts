import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchBridgeSnapshot } from './bridge-client.js';

test('times out bridge snapshot requests so offline mode can render quickly', async () => {
  const requestedUrls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requestedUrls.push(String(input));
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };

  await assert.rejects(
    fetchBridgeSnapshot({ fetchImpl, timeoutMs: 1 }),
    /aborted/,
  );
  assert.deepEqual(requestedUrls, ['http://127.0.0.1:8787/status']);
});

test('keeps the status online when the optional event stream fails', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/status')) {
      return Response.json({
        bridge: 'online',
        tunnel: 'online',
        claude: 'idle',
        lastMessageType: null,
        lastEventAt: null,
        lastError: null,
      });
    }
    return new Response('events unavailable', { status: 503 });
  };

  const snapshot = await fetchBridgeSnapshot({ fetchImpl, timeoutMs: 50 });

  assert.equal(snapshot.status.bridge, 'online');
  assert.equal(snapshot.status.tunnel, 'online');
  assert.deepEqual(snapshot.events, []);
});
