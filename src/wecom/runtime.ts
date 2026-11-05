import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNTIME_DIR } from '../constants.js';
import type { Config } from '../config.js';
import type { BridgeOnlineState, ClaudeRuntimeState } from '../bridge/status.js';
import type { FeishuMessageType } from '../feishu/webhook.js';

export type WeComRuntimeState = 'starting' | 'subscribed' | 'idle' | 'processing' | 'error' | 'closed';

export interface WeComChannelConfig {
  status?: 'planned' | 'ready';
  bridge?: 'claude-code';
  login?: 'qr' | 'webhook' | 'long_connection';
  displayName?: string;
  botId?: string;
  secret?: string;
  websocketUrl?: string;
  heartbeatSeconds?: number;
}

export interface WeComRuntimeStatus {
  channel: 'wecom';
  state: WeComRuntimeState;
  updatedAt: string;
  startedAt?: string;
  botId?: string;
  lastMessageType?: string;
  lastError?: string;
}

const ONLINE_STATES: WeComRuntimeState[] = ['subscribed', 'idle', 'processing'];
const FRESH_STATUS_MS = 45_000;

function statusPath(): string {
  return join(process.env.FEISHU_CLAUDE_CODE_RUNTIME_DIR || RUNTIME_DIR, 'wecom-long-connection.json');
}

export function getWeComChannel(config: Config): WeComChannelConfig | undefined {
  const channel = config.channels?.wecom;
  if (channel?.login !== 'long_connection') {
    return undefined;
  }
  return {
    status: channel.status,
    bridge: channel.bridge,
    login: 'long_connection',
    displayName: channel.displayName,
    botId: channel.botId,
    secret: channel.secret,
    websocketUrl: channel.websocketUrl,
    heartbeatSeconds: channel.heartbeatSeconds,
  };
}

export function weComConfigError(config: Config): string | null {
  const channel = getWeComChannel(config);
  if (config.activeChannel !== 'wecom') {
    return 'WeCom is not the active channel';
  }
  if (!channel || channel.status !== 'ready') {
    return 'WeCom long connection is not configured';
  }
  if (!channel.botId || !channel.secret) {
    return 'WeCom BotID or Secret is missing';
  }
  return null;
}

export function writeWeComRuntimeStatus(status: WeComRuntimeStatus): void {
  const path = statusPath();
  mkdirSync(process.env.FEISHU_CLAUDE_CODE_RUNTIME_DIR || RUNTIME_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(status, null, 2));
}

export function readWeComRuntimeStatus(): WeComRuntimeStatus | null {
  try {
    return JSON.parse(readFileSync(statusPath(), 'utf8')) as WeComRuntimeStatus;
  } catch {
    return null;
  }
}

export function getWeComBridgeState(now: Date = new Date()): BridgeOnlineState {
  const status = readWeComRuntimeStatus();
  if (!status || !ONLINE_STATES.includes(status.state)) {
    return 'offline';
  }
  const updatedAt = Date.parse(status.updatedAt);
  return Number.isFinite(updatedAt) && now.getTime() - updatedAt <= FRESH_STATUS_MS ? 'online' : 'offline';
}

export function getWeComClaudeState(): ClaudeRuntimeState {
  return readWeComRuntimeStatus()?.state === 'processing' ? 'processing' : 'idle';
}

export function getWeComLastMessageType(): FeishuMessageType | null {
  return normalizeMessageType(readWeComRuntimeStatus()?.lastMessageType);
}

function normalizeMessageType(value: string | undefined): FeishuMessageType | null {
  if (value === 'text' || value === 'file' || value === 'image' || value === 'audio' || value === 'media' || value === 'post') {
    return value;
  }
  return null;
}
