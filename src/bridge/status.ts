import type { FeishuMessageType } from '../feishu/webhook.js';

export type BridgeOnlineState = 'online' | 'offline';
export type ClaudeRuntimeState = 'idle' | 'processing';

export type BridgeRuntimeEvent =
  | { type: 'message_received'; messageType: FeishuMessageType; summary?: string; at: string }
  | { type: 'claude_started'; at: string }
  | { type: 'claude_completed'; at: string }
  | { type: 'error'; message: string; at: string };

export interface BridgeRuntimeStatus {
  bridge: BridgeOnlineState;
  tunnel: BridgeOnlineState;
  claude: ClaudeRuntimeState;
  lastMessageType: FeishuMessageType | null;
  lastEventAt: string | null;
  lastError: string | null;
  version: string;
}

export interface BridgeStatusTracker {
  getVersion(): string;
  getStatus(): BridgeRuntimeStatus;
  getEvents(): BridgeRuntimeEvent[];
  getEventsJsonl(): string;
  recordMessageReceived(messageType: FeishuMessageType, summary?: string): void;
  recordClaudeStarted(): void;
  recordClaudeCompleted(): void;
  recordError(error: unknown): void;
}

export function createBridgeStatusTracker(options: {
  version: string;
  getBridgeState: () => BridgeOnlineState;
  getBridgeError?: () => string | null;
  getTunnelState: () => BridgeOnlineState;
  getClaudeState?: () => ClaudeRuntimeState | undefined;
  now?: () => Date;
}): BridgeStatusTracker {
  const now = options.now ?? (() => new Date());
  const events: BridgeRuntimeEvent[] = [];
  let claude: ClaudeRuntimeState = 'idle';
  let lastMessageType: FeishuMessageType | null = null;
  let lastEventAt: string | null = null;
  let lastError: string | null = null;

  function pushEvent(event: BridgeRuntimeEvent): void {
    events.push(event);
    if (events.length > 50) {
      events.splice(0, events.length - 50);
    }
    lastEventAt = event.at;
  }

  function timestamp(): string {
    return now().toISOString();
  }

  return {
    getVersion() {
      return options.version;
    },
    getStatus() {
      const bridge = options.getBridgeState();
      const runtimeClaude = options.getClaudeState?.();
      return {
        bridge,
        tunnel: options.getTunnelState(),
        claude: runtimeClaude ?? claude,
        lastMessageType,
        lastEventAt,
        lastError: bridge === 'online' ? lastError : options.getBridgeError?.() ?? lastError,
        version: options.version,
      };
    },
    getEvents() {
      return events.map((event) => ({ ...event }));
    },
    getEventsJsonl() {
      return events.map((event) => JSON.stringify(event)).join('\n');
    },
    recordMessageReceived(messageType, summary) {
      lastMessageType = messageType;
      const event: BridgeRuntimeEvent = { type: 'message_received', messageType, at: timestamp() };
      const normalizedSummary = normalizeSummary(summary);
      if (normalizedSummary) {
        event.summary = normalizedSummary;
      }
      pushEvent(event);
    },
    recordClaudeStarted() {
      claude = 'processing';
      pushEvent({ type: 'claude_started', at: timestamp() });
    },
    recordClaudeCompleted() {
      claude = 'idle';
      pushEvent({ type: 'claude_completed', at: timestamp() });
    },
    recordError(error) {
      claude = 'idle';
      lastError = error instanceof Error ? error.message : String(error);
      pushEvent({ type: 'error', message: lastError, at: timestamp() });
    },
  };
}

function normalizeSummary(summary?: string): string | undefined {
  const normalized = summary?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }
  return normalized.length > 120 ? `${normalized.slice(0, 120)}…` : normalized;
}
