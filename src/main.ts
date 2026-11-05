import process from 'node:process';
import { loadConfig, saveConfig } from './config.js';
import { logger } from './logger.js';
import { createSessionStore } from './session.js';
import { createPermissionBroker } from './permission.js';
import { createBridgeStatusTracker } from './bridge/status.js';
import { detectTunnelState } from './bridge/tunnel.js';
import { transcribeAudio } from './audio/transcribe.js';
import { saveArtifact, type SavedArtifact } from './feishu/artifacts.js';
import { downloadMessageResource, sendTextMessage } from './feishu/send.js';
import { createWebhookServer, type FeishuIncomingMessage } from './feishu/webhook.js';
import { handleInboundTurn } from './core/inbound.js';
import { readChannelEvents } from './core/channel-events.js';
import { getWeComBridgeState, getWeComClaudeState, getWeComLastMessageType, weComConfigError } from './wecom/runtime.js';
import { getTelegramBridgeState, getTelegramClaudeState, getTelegramLastMessageType, telegramConfigError } from './telegram/runtime.js';

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

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    config.activeChannel = 'telegram';
    config.channels = {
      ...config.channels,
      telegram: {
        status: 'ready',
        bridge: 'claude-code',
        login: 'polling',
        mode: 'polling',
        displayName: 'Telegram Bot API',
        botToken: telegramToken,
        apiBaseUrl: process.env.TELEGRAM_API_BASE_URL || 'https://api.telegram.org',
        pollingTimeoutSeconds: process.env.TELEGRAM_POLLING_TIMEOUT_SECONDS
          ? Number(process.env.TELEGRAM_POLLING_TIMEOUT_SECONDS)
          : 30,
      },
    };
  }

  const wecomBotId = process.env.WECOM_BOT_ID;
  const wecomSecret = process.env.WECOM_BOT_SECRET;
  if (wecomBotId && wecomSecret) {
    config.activeChannel = 'wecom';
    config.channels = {
      ...config.channels,
      wecom: {
        status: 'ready',
        bridge: 'claude-code',
        login: 'long_connection',
        displayName: '企业微信长连接',
        botId: wecomBotId,
        secret: wecomSecret,
        websocketUrl: process.env.WECOM_WEBSOCKET_URL || 'wss://openws.work.weixin.qq.com',
        heartbeatSeconds: process.env.WECOM_HEARTBEAT_SECONDS
          ? Number(process.env.WECOM_HEARTBEAT_SECONDS)
          : 30,
      },
    };
  }

  if (!config.activeChannel) {
    config.activeChannel = 'feishu';
  }

  saveConfig(config);
  console.log('已写入基础配置到 ~/.feishu-claude-code/config.json');
  console.log(`activeChannel=${config.activeChannel}`);
  if (config.activeChannel === 'feishu') {
    console.log(`请在飞书事件订阅中配置回调地址: ${getWebhookUrl(config)}`);
  } else if (config.activeChannel === 'telegram') {
    console.log('Telegram polling 已配置。使用 npm run daemon -- start 启动 worker。');
  } else if (config.activeChannel === 'wecom') {
    console.log('企业微信长连接已配置。使用 npm run daemon -- start 启动 worker。');
  } else if (config.activeChannel === 'wechat') {
    console.log('微信个人号通道仍为 planned；当前仅保存档案，运行时尚未实现。');
  }
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
    getTunnelState: () => (config.activeChannel === 'wecom' || config.activeChannel === 'telegram' ? 'online' : detectTunnelState()),
    getClaudeState: () => {
      if (config.activeChannel === 'wecom') {
        return getWeComClaudeState();
      }
      if (config.activeChannel === 'telegram') {
        return getTelegramClaudeState();
      }
      return undefined;
    },
    getLastMessageType: () => {
      if (config.activeChannel === 'wecom') {
        return getWeComLastMessageType();
      }
      if (config.activeChannel === 'telegram') {
        return getTelegramLastMessageType();
      }
      return undefined;
    },
  });

  const originalGetEvents = statusTracker.getEvents.bind(statusTracker);
  const originalGetEventsJsonl = statusTracker.getEventsJsonl.bind(statusTracker);
  const originalGetStatus = statusTracker.getStatus.bind(statusTracker);

  statusTracker.getEvents = () => mergeEvents(originalGetEvents(), readChannelEvents());
  statusTracker.getEventsJsonl = () => statusTracker.getEvents().map((event) => JSON.stringify(event)).join('\n');
  statusTracker.getStatus = () => {
    const status = originalGetStatus();
    const merged = mergeEvents(originalGetEvents(), readChannelEvents());
    const latest = merged[merged.length - 1];
    if (latest && (!status.lastEventAt || latest.at > status.lastEventAt)) {
      status.lastEventAt = latest.at;
    }
    return status;
  };

  const server = createWebhookServer({
    port: config.port,
    path: config.webhookPath,
    verificationToken: config.verificationToken,
    encryptKey: config.encryptKey,
    statusTracker,
    onMessage: async (message) => {
      // Feishu path owns in-memory status tracker events; skip shared channel event file duplication.
      const artifacts = await downloadArtifacts(message, config.audioTranscriptionCommand);
      await handleInboundTurn({
        sessionKey: message.chatId,
        messageType: message.messageType,
        messageText: message.text || '',
        artifacts,
        links: message.links,
        config,
        sessionStore,
        permissionBroker,
        reply: async (text) => {
          await sendTextMessage('chat_id', message.chatId, text);
        },
        emitChannelEvents: false,
        onMessageReceived: (messageType, summary) => statusTracker.recordMessageReceived(messageType, summary),
        onClaudeStarted: () => statusTracker.recordClaudeStarted(),
        onClaudeCompleted: () => statusTracker.recordClaudeCompleted(),
        onError: (error) => {
          statusTracker.recordError(error);
          logger.error('Message handling failed', {
            chatId: message.chatId,
            messageId: message.messageId,
            messageType: message.messageType,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      });
    },
  });

  await server.listen();
  logger.info('Feishu Claude Code bridge started', {
    port: config.port,
    path: config.webhookPath,
    publicWebhookUrl: getWebhookUrl(config),
    activeChannel: config.activeChannel || 'feishu',
  });
  console.log(`Listening on http://127.0.0.1:${config.port}${config.webhookPath}`);
  console.log(`Public webhook URL: ${getWebhookUrl(config)}`);
  console.log(`activeChannel: ${config.activeChannel || 'feishu'}`);
  // silence unused originalGetEventsJsonl lint when tree-shaken differently
  void originalGetEventsJsonl;
}

function mergeEvents<T extends { at: string }>(primary: T[], secondary: T[]): T[] {
  return [...primary, ...secondary]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(-50);
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
  if (config.activeChannel === 'telegram') {
    const configError = telegramConfigError(config);
    if (configError) {
      return configError;
    }
    return getTelegramBridgeState() === 'online' ? null : 'Telegram polling is offline';
  }
  if (config.activeChannel === 'wechat') {
    return 'WeChat personal channel runtime is not implemented yet (planned QR-login bundle)';
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
