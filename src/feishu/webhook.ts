import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, createDecipheriv } from 'node:crypto';
import { logger } from '../logger.js';

export type FeishuMessageType = 'text' | 'file' | 'image' | 'audio' | 'media' | 'post';

export interface FeishuAttachment {
  kind: 'file' | 'image' | 'audio' | 'media';
  fileKey: string;
  fileName?: string;
  mimeType?: string;
}

export interface FeishuIncomingMessage {
  chatId: string;
  messageId: string;
  openId?: string;
  messageType: FeishuMessageType;
  text?: string;
  attachments: FeishuAttachment[];
  links: string[];
  rawSummary: string;
}

interface EventPayload {
  challenge?: string;
  token?: string;
  header?: { event_id?: string; event_type?: string; token?: string };
  event?: {
    message?: {
      message_id?: string;
      message_type?: string;
      chat_id?: string;
      content?: string;
    };
    sender?: { sender_id?: { open_id?: string } };
  };
}

function normalizePath(pathname: string | undefined): string {
  return pathname?.split('?')[0] || '/';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function decryptPayload(encryptedBase64: string, encryptKey: string): string {
  const key = createHash('sha256').update(encryptKey).digest();
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const iv = encrypted.subarray(0, 16);
  const ciphertext = encrypted.subarray(16);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return decrypted.replace(/\0+$/g, '');
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJsonContent(rawContent?: string): Record<string, unknown> {
  if (!rawContent) {
    return {};
  }
  const trimmed = rawContent.trim();
  if (!trimmed) {
    return {};
  }
  if (!trimmed.startsWith('{')) {
    return { text: trimmed };
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return { text: trimmed };
  }
}

function collectLinks(value: unknown, links: string[]): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(/https?:\/\/\S+/g)) {
      links.push(match[0]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectLinks(item, links);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      collectLinks(nested, links);
    }
  }
}

function collectText(value: unknown, parts: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      parts.push(trimmed);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectText(item, parts);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'href') {
        continue;
      }
      collectText(nested, parts);
    }
  }
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseIncomingMessage(payload: EventPayload): FeishuIncomingMessage | undefined {
  const message = payload.event?.message;
  const chatId = message?.chat_id;
  const messageId = message?.message_id;
  if (!chatId || !messageId || !message?.message_type) {
    return undefined;
  }

  const content = parseJsonContent(message.content);
  const links: string[] = [];
  const attachments: FeishuAttachment[] = [];
  collectLinks(content, links);

  let text = '';
  let messageType: FeishuMessageType | undefined;

  if (message.message_type === 'text') {
    text = toOptionalString(content.text) || '';
    messageType = 'text';
  } else if (message.message_type === 'post') {
    const parts: string[] = [];
    collectText(content, parts);
    text = parts.join('\n').trim();
    messageType = 'post';
  } else if (message.message_type === 'file') {
    const fileKey = toOptionalString(content.file_key);
    if (!fileKey) {
      return undefined;
    }
    attachments.push({
      kind: 'file',
      fileKey,
      fileName: toOptionalString(content.file_name),
      mimeType: toOptionalString(content.file_type),
    });
    text = toOptionalString(content.file_name) || '收到一个文件。';
    messageType = 'file';
  } else if (message.message_type === 'image') {
    const fileKey = toOptionalString(content.image_key) || toOptionalString(content.file_key);
    if (!fileKey) {
      logger.warn('Image message missing file key', { content });
      return undefined;
    }
    attachments.push({ kind: 'image', fileKey });
    text = '收到一张图片。';
    messageType = 'image';
  } else if (message.message_type === 'audio') {
    const fileKey = toOptionalString(content.file_key);
    if (!fileKey) {
      return undefined;
    }
    attachments.push({ kind: 'audio', fileKey, fileName: toOptionalString(content.file_name) });
    text = '收到一段音频。';
    messageType = 'audio';
  } else if (message.message_type === 'media') {
    const fileKey = toOptionalString(content.file_key);
    if (!fileKey) {
      return undefined;
    }
    attachments.push({ kind: 'media', fileKey, fileName: toOptionalString(content.file_name) });
    text = '收到一个媒体文件。';
    messageType = 'media';
  }

  if (!messageType) {
    return undefined;
  }

  return {
    chatId,
    messageId,
    openId: payload.event?.sender?.sender_id?.open_id,
    messageType,
    text: text || undefined,
    attachments,
    links: Array.from(new Set(links)),
    rawSummary: JSON.stringify({ messageType, hasText: !!text, attachments: attachments.length, links: links.length }),
  };
}

export function createWebhookServer(options: {
  port: number;
  path: string;
  verificationToken?: string;
  encryptKey?: string;
  onMessage: (message: FeishuIncomingMessage) => Promise<void>;
}) {
  const seenEventIds = new Set<string>();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST' || normalizePath(req.url) !== options.path) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    try {
      const body = await readBody(req);
      logger.info('Webhook request received', { bodyPreview: body.slice(0, 300) });
      const outerPayload = JSON.parse(body) as {
        challenge?: string;
        token?: string;
        encrypt?: string;
      };
      logger.info('Parsed outer payload', {
        hasChallenge: !!outerPayload.challenge,
        hasToken: !!outerPayload.token,
        hasEncrypt: !!outerPayload.encrypt,
      });

      if (outerPayload.encrypt && !options.encryptKey) {
        throw new Error('Received encrypted payload but FEISHU_ENCRYPT_KEY is not configured');
      }

      const payload = outerPayload.encrypt
        ? (() => {
            const decrypted = decryptPayload(outerPayload.encrypt, options.encryptKey as string);
            logger.info('Received encrypted Feishu event', { decryptedPreview: decrypted.slice(0, 200) });
            return JSON.parse(decrypted) as EventPayload;
          })()
        : outerPayload as EventPayload;
      logger.info('Parsed event payload', {
        eventType: payload.header?.event_type,
        messageType: payload.event?.message?.message_type,
        chatId: payload.event?.message?.chat_id,
      });

      const verificationToken = payload.token ?? payload.header?.token;

      if (payload.challenge) {
        if (options.verificationToken && verificationToken !== options.verificationToken) {
          logger.warn('Verification token mismatch on challenge', { receivedToken: verificationToken });
          res.statusCode = 403;
          res.end('invalid token');
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ challenge: payload.challenge }));
        return;
      }

      if (options.verificationToken && verificationToken !== options.verificationToken) {
        logger.warn('Verification token mismatch on event', { receivedToken: verificationToken });
        res.statusCode = 403;
        res.end('invalid token');
        return;
      }

      const eventId = payload.header?.event_id;
      if (eventId) {
        if (seenEventIds.has(eventId)) {
          res.statusCode = 200;
          res.end('ok');
          return;
        }
        seenEventIds.add(eventId);
        if (seenEventIds.size > 1000) {
          const ids = Array.from(seenEventIds);
          seenEventIds.clear();
          for (const id of ids.slice(-500)) {
            seenEventIds.add(id);
          }
        }
      }

      if (payload.header?.event_type !== 'im.message.receive_v1') {
        res.statusCode = 200;
        res.end('ignored');
        return;
      }

      const parsedMessage = parseIncomingMessage(payload);
      if (!parsedMessage) {
        res.statusCode = 200;
        res.end('ignored');
        return;
      }

      logger.info('Dispatching message to handler', {
        chatId: parsedMessage.chatId,
        messageType: parsedMessage.messageType,
        textPreview: parsedMessage.text?.slice(0, 200),
        attachmentCount: parsedMessage.attachments.length,
        linkCount: parsedMessage.links.length,
      });
      await options.onMessage(parsedMessage);
      logger.info('Message handler completed', { chatId: parsedMessage.chatId, messageType: parsedMessage.messageType });

      res.statusCode = 200;
      res.end('ok');
    } catch (error) {
      logger.error('Webhook handler failed', { error: error instanceof Error ? error.message : String(error) });
      res.statusCode = 500;
      res.end('error');
    }
  });

  return {
    listen() {
      return new Promise<void>((resolve) => {
        server.listen(options.port, () => resolve());
      });
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
