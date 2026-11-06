import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { createSessionStore } from '../session.js';
import { createPermissionBroker } from '../permission.js';
import { transcribeAudio } from '../audio/transcribe.js';
import { saveArtifact, type SavedArtifact } from '../feishu/artifacts.js';
import type { FeishuMessageType } from '../feishu/webhook.js';
import { handleInboundTurn } from '../core/inbound.js';
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

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
}

interface TelegramFileRef {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
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
  photo?: TelegramPhotoSize[];
  voice?: TelegramFileRef;
  audio?: TelegramFileRef;
  document?: TelegramFileRef;
  video?: TelegramFileRef & { mime_type?: string };
  video_note?: TelegramFileRef;
  sticker?: { file_id?: string; emoji?: string };
}

interface TelegramFile {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
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

function messageType(message: TelegramMessage): FeishuMessageType {
  if (message.photo?.length) {
    return 'image';
  }
  if (message.voice || message.audio) {
    return 'audio';
  }
  if (message.video || message.video_note) {
    return 'media';
  }
  if (message.document) {
    return 'file';
  }
  if (message.sticker) {
    return 'image';
  }
  return 'text';
}

function messageText(message: TelegramMessage): string {
  const text = message.text?.trim() || message.caption?.trim();
  if (text) {
    return text;
  }
  if (message.sticker?.emoji) {
    return message.sticker.emoji;
  }
  return '';
}

async function sendMessage(apiBaseUrl: string, botToken: string, chatId: number | string, text: string): Promise<void> {
  const chunks = splitTelegramText(text || '(空回复)');
  for (const chunk of chunks) {
    await telegramRequest(apiBaseUrl, botToken, 'sendMessage', {
      chat_id: chatId,
      text: chunk,
    });
  }
}

function splitTelegramText(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) {
    return [text];
  }
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) {
      splitAt = maxLen;
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

async function downloadTelegramFile(
  apiBaseUrl: string,
  botToken: string,
  fileId: string,
): Promise<{ content: Buffer; filePath?: string; fileName?: string }> {
  const file = await telegramRequest<TelegramFile>(apiBaseUrl, botToken, 'getFile', { file_id: fileId });
  if (!file.file_path) {
    throw new Error('Telegram getFile did not return file_path');
  }
  const url = `${apiBaseUrl.replace(/\/$/, '')}/file/bot${botToken}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Telegram file download failed with HTTP ${response.status}`);
  }
  const content = Buffer.from(await response.arrayBuffer());
  const fileName = file.file_path.split('/').pop();
  return { content, filePath: file.file_path, fileName };
}

function pickPrimaryFile(message: TelegramMessage): { fileId: string; kind: SavedArtifact['kind']; fileName?: string; mimeType?: string; fallbackExtension?: string } | null {
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    return { fileId: largest.file_id, kind: 'image', fallbackExtension: '.jpg', mimeType: 'image/jpeg' };
  }
  if (message.voice) {
    return {
      fileId: message.voice.file_id,
      kind: 'audio',
      fileName: message.voice.file_name,
      mimeType: message.voice.mime_type || 'audio/ogg',
      fallbackExtension: '.ogg',
    };
  }
  if (message.audio) {
    return {
      fileId: message.audio.file_id,
      kind: 'audio',
      fileName: message.audio.file_name,
      mimeType: message.audio.mime_type,
      fallbackExtension: '.mp3',
    };
  }
  if (message.document) {
    return {
      fileId: message.document.file_id,
      kind: 'file',
      fileName: message.document.file_name,
      mimeType: message.document.mime_type,
    };
  }
  if (message.video) {
    return {
      fileId: message.video.file_id,
      kind: 'media',
      fileName: message.video.file_name,
      mimeType: message.video.mime_type || 'video/mp4',
      fallbackExtension: '.mp4',
    };
  }
  if (message.video_note) {
    return {
      fileId: message.video_note.file_id,
      kind: 'media',
      mimeType: 'video/mp4',
      fallbackExtension: '.mp4',
    };
  }
  return null;
}

async function downloadArtifacts(
  apiBaseUrl: string,
  botToken: string,
  message: TelegramMessage,
  chatId: string,
  transcriptionCommand?: string,
): Promise<SavedArtifact[]> {
  const primary = pickPrimaryFile(message);
  if (!primary) {
    return [];
  }

  try {
    const downloaded = await downloadTelegramFile(apiBaseUrl, botToken, primary.fileId);
    const artifact = saveArtifact({
      chatId,
      messageId: String(message.message_id),
      kind: primary.kind,
      fileName: primary.fileName || downloaded.fileName,
      content: downloaded.content,
      fallbackExtension: primary.fallbackExtension,
      mimeType: primary.mimeType,
    });

    if (primary.kind === 'audio' || primary.kind === 'media') {
      const transcription = await transcribeAudio(artifact.localPath, transcriptionCommand, primary.kind);
      artifact.transcriptText = transcription.text;
      artifact.transcriptSource = transcription.source || transcription.error;
    }

    logger.info('Saved Telegram attachment locally', {
      chatId,
      messageId: message.message_id,
      kind: primary.kind,
      localPath: artifact.localPath,
      size: artifact.size,
    });
    return [artifact];
  } catch (error) {
    logger.error('Telegram attachment download failed', {
      chatId,
      messageId: message.message_id,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function handleMessage(
  apiBaseUrl: string,
  botToken: string,
  message: TelegramMessage,
  context: WorkerContext,
  sessionStore: ReturnType<typeof createSessionStore>,
  permissionBroker: ReturnType<typeof createPermissionBroker>,
): Promise<void> {
  const config = loadConfig();
  const chatId = `telegram-${message.chat.id}`;
  const type = messageType(message);
  const text = messageText(message);

  updateStatus(context, 'processing', { lastMessageType: type });

  const artifacts = await downloadArtifacts(apiBaseUrl, botToken, message, chatId, config.audioTranscriptionCommand);

  try {
    await handleInboundTurn({
      sessionKey: chatId,
      messageType: type,
      messageText: text,
      artifacts,
      config,
      sessionStore,
      permissionBroker,
      reply: async (replyText) => {
        await sendMessage(apiBaseUrl, botToken, message.chat.id, replyText);
      },
    });
    updateStatus(context, 'idle', { lastMessageType: type });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    updateStatus(context, 'error', { lastError: errorMessage, lastMessageType: type });
    logger.error('Telegram polling message handling failed', { error: errorMessage });
  }
}

async function handleUpdate(
  apiBaseUrl: string,
  botToken: string,
  update: TelegramUpdate,
  context: WorkerContext,
  sessionStore: ReturnType<typeof createSessionStore>,
  permissionBroker: ReturnType<typeof createPermissionBroker>,
): Promise<void> {
  updateStatus(context, 'polling', { lastUpdateId: update.update_id });
  const message = update.message ?? update.edited_message;
  if (!message) {
    return;
  }
  await handleMessage(apiBaseUrl, botToken, message, context, sessionStore, permissionBroker);
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
  const sessionStore = createSessionStore();
  const permissionBroker = createPermissionBroker();

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
        await handleUpdate(apiBaseUrl, botToken, update, context, sessionStore, permissionBroker);
      }
    } catch (error) {
      updateStatus(context, 'error', { lastError: error instanceof Error ? error.message : String(error) });
      logger.error('Telegram polling loop failed', { error: error instanceof Error ? error.message : String(error) });
      await delay(RETRY_DELAY_MS);
    }
  }
  updateStatus(context, 'closed');
}

if (process.argv[1]?.endsWith('/telegram/polling.js') || process.argv[1]?.endsWith('\\telegram\\polling.js')) {
  runTelegramPolling().catch((error) => {
    logger.error('Telegram polling worker crashed', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
