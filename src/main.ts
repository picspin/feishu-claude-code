import process from 'node:process';
import { loadConfig, saveConfig } from './config.js';
import { logger } from './logger.js';
import { createSessionStore } from './session.js';
import { createPermissionBroker } from './permission.js';
import { routeCommand } from './commands/router.js';
import { createBridgeStatusTracker } from './bridge/status.js';
import { detectTunnelState } from './bridge/tunnel.js';
import { transcribeAudio } from './audio/transcribe.js';
import { saveArtifact, type SavedArtifact } from './feishu/artifacts.js';
import { buildPrompt } from './feishu/prompt.js';
import { downloadMessageResource, sendTextMessage } from './feishu/send.js';
import { createWebhookServer, type FeishuIncomingMessage } from './feishu/webhook.js';
import { claudeQuery } from './claude/provider.js';
import { getWeComBridgeState, getWeComClaudeState, weComConfigError } from './wecom/runtime.js';

const BRIDGE_VERSION = '0.1.0';

function getWebhookUrl(config: ReturnType<typeof loadConfig>): string {
  if (config.publicBaseUrl) {
    return `${config.publicBaseUrl.replace(/\/$/, '')}${config.webhookPath}`;
  }
  return `http://127.0.0.1:${config.port}${config.webhookPath}`;
}

async function runSetup(): Promise<void> {
  const config = loadConfig();
  config.appId = process.env.FEISHU_APP_ID || config.appId;
  config.appSecret = process.env.FEISHU_APP_SECRET || config.appSecret;
  config.encryptKey = process.env.FEISHU_ENCRYPT_KEY || config.encryptKey;
  config.verificationToken = process.env.FEISHU_VERIFICATION_TOKEN || config.verificationToken;
  config.publicBaseUrl = process.env.FEISHU_PUBLIC_BASE_URL || config.publicBaseUrl;
  config.audioTranscriptionCommand = process.env.FEISHU_AUDIO_TRANSCRIPTION_COMMAND || config.audioTranscriptionCommand;
  saveConfig(config);
  console.log('已写入基础配置到 ~/.feishu-claude-code/config.json');
  console.log(`请在飞书事件订阅中配置回调地址: ${getWebhookUrl(config)}`);
}

async function downloadArtifacts(message: FeishuIncomingMessage, transcriptionCommand?: string): Promise<SavedArtifact[]> {
  const artifacts: SavedArtifact[] = [];
  for (const attachment of message.attachments) {
    if (!['file', 'image', 'audio', 'media'].includes(attachment.kind)) {
      continue;
    }
    logger.info('Downloading Feishu attachment', {
      chatId: message.chatId,
      messageId: message.messageId,
      kind: attachment.kind,
      fileKey: attachment.fileKey,
      fileName: attachment.fileName,
    });
    const resource = await downloadMessageResource(message.messageId, attachment.fileKey, attachment.kind);
    const artifact = saveArtifact({
      chatId: message.chatId,
      messageId: message.messageId,
      kind: attachment.kind,
      fileName: attachment.fileName || resource.fileName,
      content: resource.content,
      fallbackExtension: attachment.kind === 'image' ? '.png' : attachment.kind === 'audio' ? '.m4a' : undefined,
      mimeType: attachment.mimeType || resource.mimeType,
    });
    logger.info('Saved Feishu attachment locally', {
      chatId: message.chatId,
      messageId: message.messageId,
      kind: attachment.kind,
      localPath: artifact.localPath,
      size: artifact.size,
      mimeType: artifact.mimeType,
    });
    if (attachment.kind === 'audio' || attachment.kind === 'media') {
      const transcription = await transcribeAudio(artifact.localPath, transcriptionCommand, attachment.kind);
      artifact.transcriptText = transcription.text;
      artifact.transcriptSource = transcription.source || transcription.error;
      logger.info('Audio transcription completed', {
        chatId: message.chatId,
        messageId: message.messageId,
        kind: attachment.kind,
        localPath: artifact.localPath,
        transcriptSource: artifact.transcriptSource,
        hasTranscriptText: !!artifact.transcriptText,
        transcriptPreview: artifact.transcriptText?.slice(0, 200),
      });
    }
    artifacts.push(artifact);
  }
  return artifacts;
}

async function runStart(): Promise<void> {
  const config = loadConfig();
  const sessionStore = createSessionStore();
  const permissionBroker = createPermissionBroker();
  const statusTracker = createBridgeStatusTracker({
    version: BRIDGE_VERSION,
    getBridgeState: () => (isBridgeReady(config) ? 'online' : 'offline'),
    getBridgeError: () => bridgeReadinessError(config),
    getTunnelState: () => (config.activeChannel === 'wecom' ? 'online' : detectTunnelState()),
    getClaudeState: () => (config.activeChannel === 'wecom' ? getWeComClaudeState() : undefined),
  });

  const server = createWebhookServer({
    port: config.port,
    path: config.webhookPath,
    verificationToken: config.verificationToken,
    encryptKey: config.encryptKey,
    statusTracker,
    onMessage: async (message) => {
      const { chatId } = message;
      const session = sessionStore.load(chatId);
      const messageText = message.text || '';
      if (session.state === 'waiting_permission' && message.messageType === 'text') {
        const normalized = messageText.trim().toLowerCase();
        if (['y', 'yes', 'approve', '允许', '同意'].includes(normalized)) {
          permissionBroker.resolveApproval(chatId, true);
          await sendTextMessage('chat_id', chatId, '已批准，继续执行。');
          return;
        }
        if (['n', 'no', 'deny', '拒绝', '不同意'].includes(normalized)) {
          permissionBroker.resolveApproval(chatId, false);
          await sendTextMessage('chat_id', chatId, '已拒绝本次操作。');
          return;
        }
        await sendTextMessage('chat_id', chatId, '当前正在等待权限审批，请回复 y / n。');
        return;
      }

      const command = message.messageType === 'text' ? routeCommand(messageText, session) : { handled: false as const };
      const artifacts = await downloadArtifacts(message, config.audioTranscriptionCommand);
      const audioTranscript = artifacts
        .filter((artifact) => (artifact.kind === 'audio' || artifact.kind === 'media') && artifact.transcriptText)
        .map((artifact) => artifact.transcriptText?.trim())
        .filter((value): value is string => !!value)
        .join('\n');
      const effectiveMessageText = messageText || audioTranscript || `[${message.messageType}]`;
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
          await sendTextMessage('chat_id', chatId, command.reply);
        }
        if (!command.nextPrompt) {
          return;
        }
      }

      session.state = 'processing';
      sessionStore.addChatMessage(session, 'user', effectiveMessageText);
      sessionStore.save(chatId, session);
      statusTracker.recordClaudeStarted();

      try {
        const prompt = command.handled && command.nextPrompt ? command.nextPrompt : buildPrompt({ ...message, text: effectiveMessageText }, artifacts);
        const result = await claudeQuery({
          prompt,
          cwd: session.workingDirectory || config.workingDirectory,
          resume: session.sdkSessionId,
          model: session.model || config.model,
          systemPrompt: config.systemPrompt,
          permissionMode: session.permissionMode || config.permissionMode,
          onPermissionRequest: async (toolName, toolInput) => {
            session.state = 'waiting_permission';
            sessionStore.save(chatId, session);
            await sendTextMessage('chat_id', chatId, `Claude 请求权限:\n${toolName}\n${toolInput}\n回复 y / n`);
            const allowed = await permissionBroker.waitForApproval(chatId);
            session.state = 'processing';
            sessionStore.save(chatId, session);
            return allowed;
          },
        });

        session.sdkSessionId = result.sessionId || session.sdkSessionId;
        session.state = 'idle';
        sessionStore.addChatMessage(session, 'assistant', result.text || '(空回复)');
        sessionStore.save(chatId, session);
        await sendTextMessage('chat_id', chatId, result.text || '(空回复)');
        statusTracker.recordClaudeCompleted();
      } catch (error) {
        session.state = 'idle';
        sessionStore.save(chatId, session);
        const errorMessage = error instanceof Error ? error.message : String(error);
        statusTracker.recordError(error);
        logger.error('Message handling failed', {
          chatId,
          messageId: message.messageId,
          messageType: message.messageType,
          error: errorMessage,
        });
        await sendTextMessage('chat_id', chatId, `处理失败: ${errorMessage}`);
      }
    },
  });

  await server.listen();
  logger.info('Feishu Claude Code bridge started', { port: config.port, path: config.webhookPath, publicWebhookUrl: getWebhookUrl(config) });
  console.log(`Listening on http://127.0.0.1:${config.port}${config.webhookPath}`);
  console.log(`Public webhook URL: ${getWebhookUrl(config)}`);
}

function isBridgeReady(config: ReturnType<typeof loadConfig>): boolean {
  return bridgeReadinessError(config) === null;
}

function bridgeReadinessError(config: ReturnType<typeof loadConfig>): string | null {
  if (config.activeChannel === 'wecom') {
    const configError = weComConfigError(config);
    if (configError) {
      return configError;
    }
    return getWeComBridgeState() === 'online' ? null : 'WeCom long connection is offline';
  }
  if (!config.appId || !config.appSecret) {
    return 'Feishu app credentials are missing';
  }
  return null;
}

async function main(): Promise<void> {
  const command = process.argv[2] || 'start';
  if (command === 'setup') {
    await runSetup();
    return;
  }
  if (command === 'start') {
    await runStart();
    return;
  }
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

main().catch((error) => {
  logger.error('Fatal error', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
