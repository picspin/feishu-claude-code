import type { BridgeEvent, BridgeStatus } from './state.js';

const BRIDGE_BASE_URL = 'http://127.0.0.1:8787';
const DEFAULT_TIMEOUT_MS = 900;

export async function fetchBridgeSnapshot(options?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<{
  status: BridgeStatus;
  events: BridgeEvent[];
}> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const statusResponse = await fetchImpl(`${BRIDGE_BASE_URL}/status`, { cache: 'no-store', signal: controller.signal });
    if (!statusResponse.ok) {
      throw new Error(`Bridge status request failed: ${statusResponse.status}`);
    }

    const status = (await statusResponse.json()) as BridgeStatus;
    const events = await fetchImpl(`${BRIDGE_BASE_URL}/events`, { cache: 'no-store', signal: controller.signal })
      .then(async (eventsResponse) => {
        if (!eventsResponse.ok) {
          return [];
        }
        return parseNdjsonEvents(await eventsResponse.text());
      })
      .catch(() => []);

    return { status, events };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function offlineSnapshot(): { status: BridgeStatus; events: BridgeEvent[] } {
  return {
    status: {
      bridge: 'offline',
      tunnel: 'offline',
      claude: 'idle',
      lastMessageType: null,
      lastEventAt: null,
      lastError: 'Bridge unavailable',
    },
    events: [],
  };
}

function parseNdjsonEvents(value: string): BridgeEvent[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as BridgeEvent);
}
