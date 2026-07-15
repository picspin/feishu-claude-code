import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { createSessionStore } from '../session.js';
import { routeCommand } from '../commands/router.js';
import { claudeQuery } from '../claude/provider.js';
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
  const text = packet.body?.text?.content?.trim();
  if (text) {
    return text;
  }
  return `[WeCom ${packet.body?.msgtype || packet.cmd || 'message'}]`;
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

async function handleMessage(socket: WebSocketLike, packet: WeComPacket, context: WorkerContext): Promise<void> {
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
  const sessionStore = createSessionStore();
  const sessionId = `wecom-${responseSessionId(packet)}`;
  const session = sessionStore.load(sessionId);
  const messageText = responseText(packet);
  const command = packet.body?.msgtype === 'text' ? routeCommand(messageText, session) : { handled: false as const };

  updateStatus(context, 'processing', { lastMessageType: packet.body?.msgtype || 'message' });
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
    sessionStore.save(sessionId, session);
    if (command.reply) {
      respond(socket, reqId, command.reply);
    }
    if (!command.nextPrompt) {
      updateStatus(context, 'idle', { lastMessageType: packet.body?.msgtype || 'message' });
      return;
    }
  }

  session.state = 'processing';
  sessionStore.addChatMessage(session, 'user', command.handled && command.nextPrompt ? command.nextPrompt : messageText);
  sessionStore.save(sessionId, session);

  try {
    const result = await claudeQuery({
      prompt: command.handled && command.nextPrompt ? command.nextPrompt : messageText,
      cwd: session.workingDirectory || config.workingDirectory,
      resume: session.sdkSessionId,
      model: session.model || config.model,
      systemPrompt: config.systemPrompt,
      permissionMode: session.permissionMode || config.permissionMode,
    });
    session.sdkSessionId = result.sessionId || session.sdkSessionId;
    session.state = 'idle';
    sessionStore.addChatMessage(session, 'assistant', result.text || '(空回复)');
    sessionStore.save(sessionId, session);
    respond(socket, reqId, result.text || '(空回复)');
    updateStatus(context, 'idle', { lastMessageType: packet.body?.msgtype || 'message' });
  } catch (error) {
    session.state = 'idle';
    sessionStore.save(sessionId, session);
    const message = error instanceof Error ? error.message : String(error);
    respond(socket, reqId, `处理失败: ${message}`);
    updateStatus(context, 'error', { lastError: message, lastMessageType: packet.body?.msgtype || 'message' });
    logger.error('WeCom long connection message handling failed', { error: message });
  }
}

async function connectOnce(url: string, botId: string, secret: string, heartbeatSeconds: number, context: WorkerContext): Promise<void> {
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
          await handleMessage(socket, packet, context);
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
  updateStatus(context, 'starting');

  for (;;) {
    try {
      await connectOnce(websocketUrl, botId, secret, heartbeatSeconds, context);
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
