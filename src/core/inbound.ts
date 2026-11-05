import type { Config } from '../config.js';
import { claudeQuery } from '../claude/provider.js';
import { routeCommand } from '../commands/router.js';
import type { SavedArtifact } from '../feishu/artifacts.js';
import type { FeishuMessageType } from '../feishu/webhook.js';
import type { createPermissionBroker } from '../permission.js';
import type { createSessionStore } from '../session.js';
import { logger } from '../logger.js';
import { buildPromptFromParts } from './prompt.js';
import {
  recordChannelClaudeCompleted,
  recordChannelClaudeStarted,
  recordChannelError,
  recordChannelMessageReceived,
} from './channel-events.js';

const APPROVE_REPLIES = ['y', 'yes', 'approve', '允许', '同意'];
const DENY_REPLIES = ['n', 'no', 'deny', '拒绝', '不同意'];

export interface InboundTurnInput {
  sessionKey: string;
  messageType: FeishuMessageType;
  messageText: string;
  artifacts?: SavedArtifact[];
  links?: string[];
  config: Config;
  sessionStore: ReturnType<typeof createSessionStore>;
  permissionBroker: ReturnType<typeof createPermissionBroker>;
  reply: (text: string) => Promise<void>;
  /** When true, also write shared channel events for the desktop pet. Default true. */
  emitChannelEvents?: boolean;
  /** Optional extra hooks used by the in-process Feishu webhook path. */
  onMessageReceived?: (messageType: FeishuMessageType, summary?: string) => void;
  onClaudeStarted?: () => void;
  onClaudeCompleted?: () => void;
  onError?: (error: unknown) => void;
}

export type InboundTurnResult =
  | { outcome: 'permission_resolved' | 'permission_prompt' | 'command' | 'completed' | 'failed'; replyText?: string };

function recentRecoveryContext(history: Array<{ role: string; content: string }>, maxChars = 12_000): string {
  const lines: string[] = [];
  let length = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (!message) {
      continue;
    }
    const line = `${message.role}: ${message.content}`;
    if (length + line.length > maxChars && lines.length > 0) {
      break;
    }
    lines.unshift(line.slice(-maxChars));
    length += line.length;
  }
  return lines.join('\n');
}

function normalizePermissionReply(text: string): 'approve' | 'deny' | null {
  const normalized = text.trim().toLowerCase();
  if (APPROVE_REPLIES.includes(normalized)) {
    return 'approve';
  }
  if (DENY_REPLIES.includes(normalized)) {
    return 'deny';
  }
  return null;
}

function effectiveUserText(messageText: string, messageType: FeishuMessageType, artifacts: SavedArtifact[]): string {
  const trimmed = messageText.trim();
  if (trimmed) {
    return trimmed;
  }
  const audioTranscript = artifacts
    .filter((artifact) => (artifact.kind === 'audio' || artifact.kind === 'media') && artifact.transcriptText)
    .map((artifact) => artifact.transcriptText?.trim())
    .filter((value): value is string => !!value)
    .join('\n');
  return audioTranscript || `[${messageType}]`;
}

/**
 * Shared inbound turn pipeline used by Feishu, Telegram, and WeCom workers.
 */
export async function handleInboundTurn(input: InboundTurnInput): Promise<InboundTurnResult> {
  const {
    sessionKey,
    messageType,
    config,
    sessionStore,
    permissionBroker,
    reply,
  } = input;
  const artifacts = input.artifacts || [];
  const emitChannelEvents = input.emitChannelEvents !== false;
  const session = sessionStore.load(sessionKey);
  const messageText = effectiveUserText(input.messageText, messageType, artifacts);

  if (session.state === 'waiting_permission' && messageType === 'text') {
    const decision = normalizePermissionReply(messageText);
    if (decision === 'approve') {
      permissionBroker.resolveApproval(sessionKey, true);
      await reply('已批准，继续执行。');
      return { outcome: 'permission_resolved', replyText: '已批准，继续执行。' };
    }
    if (decision === 'deny') {
      permissionBroker.resolveApproval(sessionKey, false);
      await reply('已拒绝本次操作。');
      return { outcome: 'permission_resolved', replyText: '已拒绝本次操作。' };
    }
    await reply('当前正在等待权限审批，请回复 y / n。');
    return { outcome: 'permission_prompt', replyText: '当前正在等待权限审批，请回复 y / n。' };
  }

  const command = messageType === 'text' ? routeCommand(messageText, session) : { handled: false as const };
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
    sessionStore.save(sessionKey, session);
    if (command.reply) {
      await reply(command.reply);
    }
    if (!command.nextPrompt) {
      return { outcome: 'command', replyText: command.reply };
    }
  }

  const prompt = command.handled && command.nextPrompt
    ? command.nextPrompt
    : buildPromptFromParts({ text: messageText, links: input.links }, artifacts);

  input.onMessageReceived?.(messageType, messageText);
  if (emitChannelEvents) {
    recordChannelMessageReceived(messageType, messageText);
  }

  session.state = 'processing';
  sessionStore.addChatMessage(session, 'user', messageText);
  sessionStore.save(sessionKey, session);
  input.onClaudeStarted?.();
  if (emitChannelEvents) {
    recordChannelClaudeStarted();
  }

  try {
    const result = await claudeQuery({
      prompt,
      cwd: session.workingDirectory || config.workingDirectory,
      resume: session.sdkSessionId,
      model: session.model || config.model,
      systemPrompt: config.systemPrompt,
      recoveryContext: recentRecoveryContext(session.chatHistory.slice(0, -1)),
      permissionMode: session.permissionMode || config.permissionMode,
      onPermissionRequest: async (toolName, toolInput) => {
        session.state = 'waiting_permission';
        sessionStore.save(sessionKey, session);
        await reply(`Claude 请求权限:\n${toolName}\n${toolInput}\n回复 y / n`);
        const allowed = await permissionBroker.waitForApproval(sessionKey);
        session.state = 'processing';
        sessionStore.save(sessionKey, session);
        return allowed;
      },
    });

    if (result.recoveredFromContextOverflow) {
      logger.warn('Claude session exceeded the model context window; continued in a fresh session', {
        sessionKey,
        previousSessionId: session.sdkSessionId,
        nextSessionId: result.sessionId,
      });
    }

    const replyText = result.text || '(空回复)';
    session.sdkSessionId = result.sessionId || session.sdkSessionId;
    session.state = 'idle';
    sessionStore.addChatMessage(session, 'assistant', replyText);
    sessionStore.save(sessionKey, session);
    await reply(replyText);
    input.onClaudeCompleted?.();
    if (emitChannelEvents) {
      recordChannelClaudeCompleted();
    }
    return { outcome: 'completed', replyText };
  } catch (error) {
    session.state = 'idle';
    sessionStore.save(sessionKey, session);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const replyText = `处理失败: ${errorMessage}`;
    input.onError?.(error);
    if (emitChannelEvents) {
      recordChannelError(error);
    }
    await reply(replyText);
    return { outcome: 'failed', replyText };
  }
}
