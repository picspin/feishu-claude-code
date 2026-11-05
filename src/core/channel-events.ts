import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RUNTIME_DIR } from '../constants.js';
import type { BridgeRuntimeEvent } from '../bridge/status.js';
import type { FeishuMessageType } from '../feishu/webhook.js';

const MAX_EVENTS = 50;

function eventsPath(): string {
  return join(process.env.FEISHU_CLAUDE_CODE_RUNTIME_DIR || RUNTIME_DIR, 'channel-events.jsonl');
}

export function appendChannelEvent(event: BridgeRuntimeEvent): void {
  const path = eventsPath();
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
  trimChannelEvents(path);
}

export function recordChannelMessageReceived(messageType: FeishuMessageType, summary?: string): void {
  const event: BridgeRuntimeEvent = {
    type: 'message_received',
    messageType,
    at: new Date().toISOString(),
  };
  if (summary) {
    event.summary = summary.length > 120 ? `${summary.slice(0, 120)}…` : summary;
  }
  appendChannelEvent(event);
}

export function recordChannelClaudeStarted(): void {
  appendChannelEvent({ type: 'claude_started', at: new Date().toISOString() });
}

export function recordChannelClaudeCompleted(): void {
  appendChannelEvent({ type: 'claude_completed', at: new Date().toISOString() });
}

export function recordChannelError(error: unknown): void {
  appendChannelEvent({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
    at: new Date().toISOString(),
  });
}

export function readChannelEvents(): BridgeRuntimeEvent[] {
  const path = eventsPath();
  if (!existsSync(path)) {
    return [];
  }
  try {
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const events: BridgeRuntimeEvent[] = [];
    for (const line of lines.slice(-MAX_EVENTS)) {
      try {
        events.push(JSON.parse(line) as BridgeRuntimeEvent);
      } catch {
        // ignore corrupt lines
      }
    }
    return events;
  } catch {
    return [];
  }
}

function trimChannelEvents(path: string): void {
  try {
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length <= MAX_EVENTS) {
      return;
    }
    writeFileSync(path, `${lines.slice(-MAX_EVENTS).join('\n')}\n`);
  } catch {
    // best-effort trim
  }
}
