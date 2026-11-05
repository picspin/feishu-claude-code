import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { createSessionStore } from '../session.js';
import { routeCommand } from '../commands/router.js';
import { claudeQuery } from '../claude/provider.js';
import {
  getTelegramChannel,
  telegramConfigError,
  writeTelegramRuntimeStatus,
  type TelegramRuntimeState,
} from './runtime.js';

const DEFAULT_API_BASE_URL = 'https://api.telegram.org';
const DEFAULT_POLLING_TIMEOUT_SECONDS = 30;
const RETRY_DELAY_MS = 5_000;

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  text?: string;
  caption?: string;
  chat: {
    id: number | string;
  };
  from?: {
    id?: number;
    username?: string;
  };
  photo?: unknown[];
  voice?: unknown;
  audio?: unknown;
  document?: unknown;
  video?: unknown;
  sticker?: unknown;
}

interface WorkerContext {
  startedAt: string;
  lastUpdateId?: number;
}

function updateStatus(
  context: WorkerContext,
  state: TelegramRuntimeState,
  details: Partial<{ lastUpdateId: number; lastMessageType: string; lastError: string }> = {},
): void {
  if (details.lastUpdateId !== undefined) {
    context.lastUpdateId = details.lastUpdateId;
  }
  writeTelegramRuntimeStatus({
    channel: 'telegram',
    state,
    startedAt: context.startedAt,
    updatedAt: new Date().toISOString(),
    lastUpdateId: context.lastUpdateId,
    ...details,
  });
}

function apiUrl(apiBaseUrl: string, botToken: string, method: string): string {
  return `${apiBaseUrl.replace(/\/$/, '')}/bot${botToken}/${method}`;
}

async function telegramRequest<T>(apiBaseUrl: string, botToken: string, method: string, body: object = {}): Promise<T> {
  const response = await fetch(apiUrl(apiBaseUrl, botToken, method), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as TelegramApiResponse<T>;
  if (!response.ok || !payload.ok) {
    throw new Error(payload.description || `Telegram ${method} failed with HTTP ${response.status}`);
  }
  return payload.result as T;
}

function messageType(message: TelegramMessage): 'text' | 'image' | 'audio' | 'file' | 'media' {
  if (message.text || message.caption) {
    return 'text';
  }
  if (message.photo) {
    return 'image';
  }
  if (message.voice || message.audio) {
    return 'audio';
  }
  if (message.document) {
    return 'file';
  }
  return 'media';
}

function messageText(message: TelegramMessage): string {
  const text = message.text?.trim() || message.caption?.trim();
  if (text) {
    return text;
  }
  return `[Telegram ${messageType(message)}]`;
}

async function sendMessage(apiBaseUrl: string, botToken: string, chatId: number | string, text: string): Promise<void> {
  await telegramRequest(apiBaseUrl, botToken, 'sendMessage', {
    chat_id: chatId,
    text: text || '(空回复)',
  });
}

async function handleMessage(
  apiBaseUrl: string,
  botToken: string,
  message: TelegramMessage,
  context: WorkerContext,
): Promise<void> {
  const config = loadConfig();
  const sessionStore = createSessionStore();
  const chatId = `telegram-${message.chat.id}`;
  const session = sessionStore.load(chatId);
  const type = messageType(message);
  const text = messageText(message);
  const command = type === 'text' ? routeCommand(text, session) : { handled: false as const };

  updateStatus(context, 'processing', { lastMessageType: type });
  if (command.handled) {
    if (command.clearSession) {
      session.sdkSessionId = undefined;
      session.chatHistory = [];
      session.state = 'idle';
    }
    if (command.nextPermissionMode) {
      session.permissionMode = command.nextPermissionMode;
    }
    if (command.nextModel) {
      session.model = command.nextModel;
    }
    sessionStore.save(chatId, session);
    if (command.reply) {
      await sendMessage(apiBaseUrl, botToken, message.chat.id, command.reply);
    }
    if (!command.nextPrompt) {
      updateStatus(context, 'idle', { lastMessageType: type });
      return;
    }
  }

  const prompt = command.handled && command.nextPrompt ? command.nextPrompt : text;
  session.state = 'processing';
  sessionStore.addChatMessage(session, 'user', prompt);
  sessionStore.save(chatId, session);

  try {
    const result = await claudeQuery({
      prompt,
      cwd: session.workingDirectory || config.workingDirectory,
      resume: session.sdkSessionId,
      model: session.model || config.model,
      systemPrompt: config.systemPrompt,
      permissionMode: session.permissionMode || config.permissionMode,
    });
    session.sdkSessionId = result.sessionId || session.sdkSessionId;
    session.state = 'idle';
    sessionStore.addChatMessage(session, 'assistant', result.text || '(空回复)');
    sessionStore.save(chatId, session);
    await sendMessage(apiBaseUrl, botToken, message.chat.id, result.text || '(空回复)');
    updateStatus(context, 'idle', { lastMessageType: type });
  } catch (error) {
    session.state = 'idle';
    sessionStore.save(chatId, session);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendMessage(apiBaseUrl, botToken, message.chat.id, `处理失败: ${errorMessage}`);
    updateStatus(context, 'error', { lastError: errorMessage, lastMessageType: type });
    logger.error('Telegram polling message handling failed', { error: errorMessage });
  }
}

async function handleUpdate(apiBaseUrl: string, botToken: string, update: TelegramUpdate, context: WorkerContext): Promise<void> {
  updateStatus(context, 'polling', { lastUpdateId: update.update_id });
  const message = update.message ?? update.edited_message;
  if (!message) {
    return;
  }
  await handleMessage(apiBaseUrl, botToken, message, context);
}

export async function runTelegramPolling(): Promise<void> {
  const config = loadConfig();
  const configError = telegramConfigError(config);
  if (configError) {
    throw new Error(configError);
  }
  const channel = getTelegramChannel(config);
  const botToken = channel?.botToken ?? '';
  const apiBaseUrl = channel?.apiBaseUrl || DEFAULT_API_BASE_URL;
  const pollingTimeoutSeconds = channel?.pollingTimeoutSeconds || DEFAULT_POLLING_TIMEOUT_SECONDS;
  const context: WorkerContext = { startedAt: new Date().toISOString() };

  updateStatus(context, 'starting');
  await telegramRequest(apiBaseUrl, botToken, 'deleteWebhook', { drop_pending_updates: false });

  let offset: number | undefined;
  while (!process.exitCode) {
    try {
      updateStatus(context, 'polling');
      const updates = await telegramRequest<TelegramUpdate[]>(apiBaseUrl, botToken, 'getUpdates', {
        offset,
        timeout: pollingTimeoutSeconds,
        allowed_updates: ['message', 'edited_message'],
      });
      for (const update of updates) {
        offset = update.update_id + 1;
        await handleUpdate(apiBaseUrl, botToken, update, context);
      }
    } catch (error) {
      updateStatus(context, 'error', { lastError: error instanceof Error ? error.message : String(error) });
      logger.error('Telegram polling loop failed', { error: error instanceof Error ? error.message : String(error) });
      await delay(RETRY_DELAY_MS);
    }
  }
  updateStatus(context, 'closed');
}

if (process.argv[1]?.endsWith('/telegram/polling.js')) {
  runTelegramPolling().catch((error) => {
    logger.error('Telegram polling worker crashed', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
