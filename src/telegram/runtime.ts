import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUNTIME_DIR } from '../constants.js';
import type { Config } from '../config.js';
import type { BridgeOnlineState, ClaudeRuntimeState } from '../bridge/status.js';
import type { FeishuMessageType } from '../feishu/webhook.js';

export type TelegramRuntimeState = 'starting' | 'polling' | 'idle' | 'processing' | 'error' | 'closed';

export interface TelegramChannelConfig {
  status?: 'planned' | 'ready';
  bridge?: 'claude-code';
  login?: 'polling' | 'webhook';
  mode?: 'polling' | 'webhook';
  displayName?: string;
  botToken?: string;
  apiBaseUrl?: string;
  pollingTimeoutSeconds?: number;
}

export interface TelegramRuntimeStatus {
  channel: 'telegram';
  state: TelegramRuntimeState;
  updatedAt: string;
  startedAt?: string;
  lastUpdateId?: number;
  lastMessageType?: string;
  lastError?: string;
}

const ONLINE_STATES: TelegramRuntimeState[] = ['polling', 'idle', 'processing'];
const FRESH_STATUS_MS = 90_000;

function statusPath(): string {
  return join(process.env.FEISHU_CLAUDE_CODE_RUNTIME_DIR || RUNTIME_DIR, 'telegram-polling.json');
}

export function getTelegramChannel(config: Config): TelegramChannelConfig | undefined {
  const channel = config.channels?.telegram;
  if (channel?.login !== 'polling' && channel?.mode !== 'polling') {
    return undefined;
  }
  return {
    status: channel.status,
    bridge: channel.bridge,
    login: 'polling',
    mode: 'polling',
    displayName: channel.displayName,
    botToken: channel.botToken,
    apiBaseUrl: channel.apiBaseUrl,
    pollingTimeoutSeconds: channel.pollingTimeoutSeconds,
  };
}

export function telegramConfigError(config: Config): string | null {
  const channel = getTelegramChannel(config);
  if (config.activeChannel !== 'telegram') {
    return 'Telegram is not the active channel';
  }
  if (!channel || channel.status !== 'ready') {
    return 'Telegram polling is not configured';
  }
  if (!channel.botToken) {
    return 'Telegram bot token is missing';
  }
  return null;
}

export function writeTelegramRuntimeStatus(status: TelegramRuntimeStatus): void {
  const path = statusPath();
  mkdirSync(process.env.FEISHU_CLAUDE_CODE_RUNTIME_DIR || RUNTIME_DIR, { recursive: true });
  writeFileSync(path, JSON.stringify(status, null, 2));
}

export function readTelegramRuntimeStatus(): TelegramRuntimeStatus | null {
  try {
    return JSON.parse(readFileSync(statusPath(), 'utf8')) as TelegramRuntimeStatus;
  } catch {
    return null;
  }
}

export function getTelegramBridgeState(now: Date = new Date()): BridgeOnlineState {
  const status = readTelegramRuntimeStatus();
  if (!status || !ONLINE_STATES.includes(status.state)) {
    return 'offline';
  }
  const updatedAt = Date.parse(status.updatedAt);
  return Number.isFinite(updatedAt) && now.getTime() - updatedAt <= FRESH_STATUS_MS ? 'online' : 'offline';
}

export function getTelegramClaudeState(): ClaudeRuntimeState {
  return readTelegramRuntimeStatus()?.state === 'processing' ? 'processing' : 'idle';
}

export function getTelegramLastMessageType(): FeishuMessageType | null {
  return normalizeMessageType(readTelegramRuntimeStatus()?.lastMessageType);
}

function normalizeMessageType(value: string | undefined): FeishuMessageType | null {
  if (value === 'text' || value === 'file' || value === 'image' || value === 'audio' || value === 'media' || value === 'post') {
    return value;
  }
  return null;
}
