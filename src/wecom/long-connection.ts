import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { createSessionStore } from '../session.js';
import { createPermissionBroker } from '../permission.js';
import type { FeishuMessageType } from '../feishu/webhook.js';
import { handleInboundTurn } from '../core/inbound.js';
import {
  getWeComChannel,
  weComConfigError,
  writeWeComRuntimeStatus,
  type WeComRuntimeState,
} from './runtime.js';

const DEFAULT_WEBSOCKET_URL = 'wss://openws.work.weixin.qq.com';
const DEFAULT_HEARTBEAT_SECONDS = 30;
const RECONNECT_DELAY_MS = 5_000;

type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: { data?: unknown; error?: unknown }) => void): void;
};

type WebSocketCtor = new (url: string) => WebSocketLike;

interface WeComPacket {
  cmd?: string;
  headers?: {
    req_id?: string;
  };
  body?: {
    msgid?: string;
    aibotid?: string;
    chatid?: string;
    chattype?: 'single' | 'group';
    from?: {
      userid?: string;
    };
    msgtype?: string;
    text?: {
      content?: string;
    };
    event?: {
      eventtype?: string;
    };
  };
  errcode?: number;
  errmsg?: string;
}

interface WorkerContext {
  startedAt: string;
  botId: string;
}

function websocketCtor(): WebSocketCtor {
  const ctor = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  if (!ctor) {
    throw new Error('Node.js WebSocket API is unavailable. Use Node.js 22+ for WeCom long connection.');
  }
  return ctor;
}

function updateStatus(context: WorkerContext, state: WeComRuntimeState, details: Partial<{ lastMessageType: string; lastError: string }> = {}): void {
  writeWeComRuntimeStatus({
    channel: 'wecom',
    state,
    startedAt: context.startedAt,
    updatedAt: new Date().toISOString(),
    botId: context.botId,
    ...details,
  });
}

function sendPacket(socket: WebSocketLike, packet: object): void {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(packet));
  }
}

function subscribe(socket: WebSocketLike, botId: string, secret: string): void {
  sendPacket(socket, {
    cmd: 'aibot_subscribe',
    headers: { req_id: randomUUID() },
    body: { bot_id: botId, secret },
  });
}

function ping(socket: WebSocketLike): void {
  sendPacket(socket, {
    cmd: 'ping',
    headers: { req_id: randomUUID() },
  });
}

function responseSessionId(packet: WeComPacket): string {
  return packet.body?.chatid || packet.body?.from?.userid || packet.body?.msgid || 'wecom';
}

function responseText(packet: WeComPacket): string {
  return packet.body?.text?.content?.trim() || '';
}

function mapMessageType(msgtype: string | undefined): FeishuMessageType {
  switch ((msgtype || '').toLowerCase()) {
    case 'image':
      return 'image';
    case 'voice':
    case 'audio':
      return 'audio';
    case 'video':
    case 'mixed':
      return 'media';
    case 'file':
      return 'file';
    case 'text':
    default:
      return 'text';
  }
}

function respond(socket: WebSocketLike, reqId: string, content: string): void {
  sendPacket(socket, {
    cmd: 'aibot_respond_msg',
    headers: { req_id: reqId },
    body: {
      msgtype: 'stream',
      stream: {
        id: randomUUID(),
        finish: true,
        content: content || '(空回复)',
      },
    },
  });
}

async function handleMessage(
  socket: WebSocketLike,
  packet: WeComPacket,
  context: WorkerContext,
  sessionStore: ReturnType<typeof createSessionStore>,
  permissionBroker: ReturnType<typeof createPermissionBroker>,
): Promise<void> {
  if (packet.errcode !== undefined && packet.errcode !== 0) {
    updateStatus(context, 'error', { lastError: packet.errmsg || `WeCom errcode ${packet.errcode}` });
    return;
  }

  if (packet.errcode === 0 && packet.cmd === undefined) {
    updateStatus(context, 'subscribed');
    return;
  }

  if (packet.cmd === 'aibot_event_callback') {
    updateStatus(context, 'idle', { lastMessageType: packet.body?.event?.eventtype || 'event' });
    return;
  }

  if (packet.cmd !== 'aibot_msg_callback') {
    updateStatus(context, 'idle');
    return;
  }

  const reqId = packet.headers?.req_id;
  if (!reqId) {
    updateStatus(context, 'error', { lastError: 'WeCom callback is missing headers.req_id' });
    return;
  }

  const config = loadConfig();
  const sessionId = `wecom-${responseSessionId(packet)}`;
  const messageType = mapMessageType(packet.body?.msgtype);
  const messageText = responseText(packet) || (messageType === 'text' ? '' : `[WeCom ${packet.body?.msgtype || 'message'}]`);

  updateStatus(context, 'processing', { lastMessageType: messageType });

  try {
    await handleInboundTurn({
      sessionKey: sessionId,
      messageType,
      messageText,
      config,
      sessionStore,
      permissionBroker,
      reply: async (text) => {
        respond(socket, reqId, text);
      },
    });
    updateStatus(context, 'idle', { lastMessageType: messageType });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    respond(socket, reqId, `处理失败: ${message}`);
    updateStatus(context, 'error', { lastError: message, lastMessageType: messageType });
    logger.error('WeCom long connection message handling failed', { error: message });
  }
}

async function connectOnce(
  url: string,
  botId: string,
  secret: string,
  heartbeatSeconds: number,
  context: WorkerContext,
  sessionStore: ReturnType<typeof createSessionStore>,
  permissionBroker: ReturnType<typeof createPermissionBroker>,
): Promise<void> {
  const Socket = websocketCtor();
  const socket = new Socket(url);
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', (event) => reject(event.error instanceof Error ? event.error : new Error('WeCom WebSocket connection failed')));
  });

  subscribe(socket, botId, secret);
  updateStatus(context, 'starting');
  heartbeat = setInterval(() => ping(socket), heartbeatSeconds * 1_000);

  await new Promise<void>((resolve) => {
    socket.addEventListener('message', (event) => {
      void (async () => {
        try {
          const packet = JSON.parse(String(event.data)) as WeComPacket;
          await handleMessage(socket, packet, context, sessionStore, permissionBroker);
        } catch (error) {
          updateStatus(context, 'error', { lastError: error instanceof Error ? error.message : String(error) });
        }
      })();
    });
    socket.addEventListener('close', () => resolve());
    socket.addEventListener('error', () => resolve());
  });

  if (heartbeat !== undefined) {
    clearInterval(heartbeat);
  }
  socket.close();
  updateStatus(context, 'closed');
}

export async function runWeComLongConnection(): Promise<void> {
  const config = loadConfig();
  const configError = weComConfigError(config);
  if (configError) {
    throw new Error(configError);
  }

  const channel = getWeComChannel(config);
  const botId = channel?.botId ?? '';
  const secret = channel?.secret ?? '';
  const websocketUrl = channel?.websocketUrl || DEFAULT_WEBSOCKET_URL;
  const heartbeatSeconds = channel?.heartbeatSeconds || DEFAULT_HEARTBEAT_SECONDS;
  const context: WorkerContext = { startedAt: new Date().toISOString(), botId };
  const sessionStore = createSessionStore();
  const permissionBroker = createPermissionBroker();
  updateStatus(context, 'starting');

  for (;;) {
    try {
      await connectOnce(websocketUrl, botId, secret, heartbeatSeconds, context, sessionStore, permissionBroker);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateStatus(context, 'error', { lastError: message });
      logger.error('WeCom long connection failed', { error: message });
    }
    await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
  }
}

if (process.argv[1]?.endsWith('long-connection.js')) {
  runWeComLongConnection().catch((error) => {
    logger.error('WeCom long connection fatal error', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  });
}
