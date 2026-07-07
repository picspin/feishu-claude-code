import { fetchBridgeSnapshot, offlineSnapshot } from './bridge-client.js';
import { describeCrabActivity } from './activity.js';
import { renderCrabState } from './crab.js';
import { createGestureTracker } from './gestures.js';
import { clearInteractionAfter } from './animation.js';
import { deriveCrabState, type InteractionState } from './state.js';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createPetDrag } from './drag.js';
import { createTimedPetDisplay } from './display-state.js';
import { createCrawlLocomotion } from './locomotion.js';
import { ensureDaemon, frontmostWindowBounds, openSetupGuide, positionNearDock, quitApp, saveSetupConfig, startDaemon } from './tauri.js';

const PET_WINDOW_SIZE = { width: 160, height: 124 };
const SETUP_WINDOW_SIZE = { width: 460, height: 560 };
const ONBOARDING_KEY = 'dardanus-onboarding-seen-v1';
type SetupChannel = 'feishu' | 'wechat' | 'wecom';
type SetupLanguage = 'zh' | 'en';
type SetupView = 'choose' | 'coach' | 'loading';
type LocalizedText = Record<SetupLanguage, string>;
interface SetupField {
  key: string;
  label: LocalizedText;
  placeholder: LocalizedText;
  secret?: boolean;
  optional?: boolean;
}
interface SetupStep {
  title: LocalizedText;
  body: LocalizedText;
  guideUrl?: string;
  action: LocalizedText;
  fields?: SetupField[];
}
interface SetupClient {
  channel: SetupChannel;
  label: LocalizedText;
  intro: LocalizedText;
  badge: LocalizedText;
  guideUrl: string;
  steps: SetupStep[];
}

const SETUP_CLIENTS: SetupClient[] = [
  {
    channel: 'feishu',
    label: { zh: '飞书 / Lark', en: 'Feishu / Lark' },
    intro: {
      zh: '连接当前可用的 Feishu/Lark 到本地 Claude Code bridge。',
      en: 'Connect the currently available Feishu/Lark path to the local Claude Code bridge.',
    },
    badge: { zh: '当前可用', en: 'Available now' },
    guideUrl: 'https://open.feishu.cn/',
    steps: [
      {
        title: { zh: '打开开发者后台', en: 'Open developer console' },
        body: {
          zh: '在飞书或 Lark 开放平台创建企业自建应用，并进入应用详情页。',
          en: 'Create an internal app in the Feishu or Lark developer console and open its app detail page.',
        },
        guideUrl: 'https://open.feishu.cn/',
        action: { zh: '打开飞书后台', en: 'Open Feishu console' },
      },
      {
        title: { zh: '启用机器人能力', en: 'Enable bot capability' },
        body: {
          zh: '在应用能力中添加机器人，并授予接收消息、发送消息相关权限；发布或安装到你的测试企业。',
          en: 'Add the bot capability, grant message receive/send permissions, then publish or install it to your test tenant.',
        },
        action: { zh: '我已启用机器人', en: 'Bot is enabled' },
      },
      {
        title: { zh: '配置事件订阅', en: 'Configure event subscription' },
        body: {
          zh: '进入事件订阅，订阅 im.message.receive_v1。回调地址使用 Cloudflare tunnel 的公开地址加 /feishu/webhook。',
          en: 'Open event subscription and subscribe to im.message.receive_v1. Use your Cloudflare tunnel public URL plus /feishu/webhook.',
        },
        fields: [
          {
            key: 'publicBaseUrl',
            label: { zh: '公开 Base URL', en: 'Public Base URL' },
            placeholder: { zh: 'https://feishu.hilbert-space.store', en: 'https://feishu.hilbert-space.store' },
            optional: true,
          },
        ],
        action: { zh: '我已配置回调', en: 'Callback is configured' },
      },
      {
        title: { zh: '复制应用密钥', en: 'Copy app credentials' },
        body: {
          zh: '在“凭证与基础信息”复制 App ID 和 App Secret；在事件订阅页复制 Verification Token，若开启加密则复制 Encrypt Key。',
          en: 'Copy App ID and App Secret from credentials, then copy Verification Token from event subscription. Add Encrypt Key if encryption is enabled.',
        },
        fields: [
          { key: 'appId', label: { zh: 'App ID', en: 'App ID' }, placeholder: { zh: 'cli_a...', en: 'cli_a...' } },
          {
            key: 'appSecret',
            label: { zh: 'App Secret', en: 'App Secret' },
            placeholder: { zh: '粘贴 App Secret', en: 'Paste app secret' },
            secret: true,
          },
          {
            key: 'verificationToken',
            label: { zh: 'Verification Token', en: 'Verification Token' },
            placeholder: { zh: '粘贴事件 token', en: 'Paste event token' },
            optional: true,
          },
          {
            key: 'encryptKey',
            label: { zh: 'Encrypt Key', en: 'Encrypt Key' },
            placeholder: { zh: '可选：事件加密 key', en: 'Optional encrypted event key' },
            secret: true,
            optional: true,
          },
        ],
        action: { zh: '保存并构建桥接', en: 'Save and build bridge' },
      },
    ],
  },
  {
    channel: 'wechat',
    label: { zh: '微信', en: 'WeChat' },
    intro: {
      zh: '为后续 WeChat Claude Code channel bundle 预留扫码接入路线。',
      en: 'Prepare the future WeChat Claude Code channel bundle with QR login.',
    },
    badge: { zh: '规划中', en: 'Planned' },
    guideUrl: 'https://github.com/Tencent/openclaw-weixin',
    steps: [
      {
        title: { zh: '确认微信通道路线', en: 'Review WeChat channel route' },
        body: {
          zh: 'Dardanus 会保留 Claude Code bridge 架构，参考扫码登录通道形态，但不会把产品变成 OpenClaw plugin。',
          en: 'Dardanus keeps the Claude Code bridge architecture and uses QR-login channel design as reference, without becoming an OpenClaw plugin.',
        },
        guideUrl: 'https://github.com/Tencent/openclaw-weixin',
        action: { zh: '打开参考页面', en: 'Open reference' },
      },
      {
        title: { zh: '预留通道档案', en: 'Reserve channel profile' },
        body: {
          zh: '先保存一个本地通道档案。等 WeChat bundle 落地后，Dardanus 会用同一套引导补齐扫码和会话桥接。',
          en: 'Save a local channel profile now. Once the WeChat bundle lands, Dardanus will continue the QR and session bridge setup here.',
        },
        fields: [
          {
            key: 'displayName',
            label: { zh: '通道名称', en: 'Channel Name' },
            placeholder: { zh: '我的微信桥接', en: 'My WeChat bridge' },
          },
          {
            key: 'callbackUrl',
            label: { zh: '回调地址', en: 'Callback URL' },
            placeholder: { zh: '可选：本地回调地址', en: 'Optional local callback URL' },
            optional: true,
          },
        ],
        action: { zh: '保存预留档案', en: 'Save profile' },
      },
    ],
  },
  {
    channel: 'wecom',
    label: { zh: '企业微信', en: 'WeCom' },
    intro: {
      zh: '通过企业微信智能机器人长连接接入本地 Claude Code bridge。',
      en: 'Connect a WeCom intelligent bot long connection to the local Claude Code bridge.',
    },
    badge: { zh: '长连接', en: 'Long connection' },
    guideUrl: 'https://developer.work.weixin.qq.com/document/path/101463',
    steps: [
      {
        title: { zh: '打开智能机器人文档', en: 'Open intelligent bot docs' },
        body: {
          zh: '进入企业微信智能机器人长连接文档，并在企业微信管理后台创建或打开一个智能机器人。',
          en: 'Open the WeCom intelligent bot long-connection docs, then create or open an intelligent bot in the WeCom admin console.',
        },
        guideUrl: 'https://developer.work.weixin.qq.com/document/path/101463',
        action: { zh: '打开企业微信文档', en: 'Open WeCom docs' },
      },
      {
        title: { zh: '开启长连接 API 模式', en: 'Enable long-connection API mode' },
        body: {
          zh: '在机器人配置页启用 API 模式，并选择“长连接”。该模式无需公网回调地址，但同一 BotID 同时只能保持一个有效连接。',
          en: 'Enable API mode on the bot configuration page and choose long connection. This does not need a public callback URL, but one BotID can only keep one active connection at a time.',
        },
        action: { zh: '我已开启长连接', en: 'Long connection is enabled' },
      },
      {
        title: { zh: '粘贴 BotID 与 Secret', en: 'Paste BotID and Secret' },
        body: {
          zh: '复制企业微信后台展示的 BotID 和长连接专用 Secret。Dardanus 会用它们向 wss://openws.work.weixin.qq.com 订阅消息。',
          en: 'Copy the BotID and long-connection Secret shown in WeCom. Dardanus will subscribe to wss://openws.work.weixin.qq.com with them.',
        },
        fields: [
          {
            key: 'botId',
            label: { zh: 'BotID', en: 'BotID' },
            placeholder: { zh: '企业微信智能机器人 BotID', en: 'WeCom intelligent bot BotID' },
          },
          {
            key: 'secret',
            label: { zh: 'Secret', en: 'Secret' },
            placeholder: { zh: '长连接专用 Secret', en: 'Long-connection Secret' },
            secret: true,
          },
          {
            key: 'websocketUrl',
            label: { zh: 'WebSocket 地址', en: 'WebSocket URL' },
            placeholder: { zh: 'wss://openws.work.weixin.qq.com', en: 'wss://openws.work.weixin.qq.com' },
            optional: true,
          },
          {
            key: 'heartbeatSeconds',
            label: { zh: '心跳间隔秒数', en: 'Heartbeat seconds' },
            placeholder: { zh: '30', en: '30' },
            optional: true,
          },
        ],
        action: { zh: '保存并启动长连接', en: 'Save and start long connection' },
      },
    ],
  },
];
const SETUP_COPY = {
  chooseTitle: { zh: '选择你的 IM 接入方式', en: 'Choose an IM channel' },
  chooseBody: {
    zh: 'Dardanus 会像教练一样一步一步带你完成 Claude Code bridge 初始化。先选择入口，下一屏只显示该入口需要做的事情。',
    en: 'Dardanus will coach you through Claude Code bridge setup. Choose one entry point first; the next screen only shows that channel.',
  },
  language: { zh: '中文', en: 'English' },
  back: { zh: '返回', en: 'Back' },
  next: { zh: '下一步', en: 'Next' },
  done: { zh: '完成', en: 'Done' },
  connect: { zh: '开始构建', en: 'Build' },
  openGuide: { zh: '打开页面', en: 'Open' },
  finish: { zh: '完成设置', en: 'Finish' },
  loadingDone: {
    zh: '桥接初始化已提交。Dardanus 会在 bridge 与 tunnel 健康后切换状态。',
    en: 'Bridge setup was submitted. Dardanus will update state after bridge and tunnel are healthy.',
  },
};
const LOADING_FRAMES = {
  zh: ['[|] 检查密钥', '[/] 写入配置', '[-] 拉起桥接', '[\\] 等待 tunnel'],
  en: ['[|] checking keys', '[/] writing config', '[-] waking bridge', '[\\] waiting for tunnel'],
} satisfies Record<SetupLanguage, string[]>;

const appWindow = getCurrentWindow();
const button = document.querySelector<HTMLElement>('#crab-button');
const panel = document.querySelector<HTMLElement>('#bubble-panel');
const menu = document.querySelector<HTMLElement>('#crab-menu');
const appRoot = document.querySelector<HTMLElement>('#app');
const setupPanel = document.querySelector<HTMLElement>('#setup-panel');
const setupCount = document.querySelector<HTMLElement>('#setup-count');
const setupTitle = document.querySelector<HTMLElement>('#setup-title');
const setupBody = document.querySelector<HTMLElement>('#setup-body');
const setupLanguagePicker = document.querySelector<HTMLElement>('#setup-language');
const setupClientList = document.querySelector<HTMLElement>('#setup-client-list');
const setupStepList = document.querySelector<HTMLElement>('#setup-step-list');
const setupForm = document.querySelector<HTMLFormElement>('#setup-form');
const setupLog = document.querySelector<HTMLElement>('#setup-log');

if (
  !button ||
  !panel ||
  !menu ||
  !appRoot ||
  !setupPanel ||
  !setupCount ||
  !setupTitle ||
  !setupBody ||
  !setupLanguagePicker ||
  !setupClientList ||
  !setupStepList ||
  !setupForm ||
  !setupLog
) {
  throw new Error('Crab UI did not mount');
}

const crabButton = button;
const bubblePanel = panel;
const crabMenu = menu;
const root = appRoot;
const setup = setupPanel;
const setupStepCount = setupCount;
const setupStepTitle = setupTitle;
const setupStepBody = setupBody;
const setupLanguages = setupLanguagePicker;
const setupClients = setupClientList;
const setupSteps = setupStepList;
const setupFields = setupForm;
const setupOutput = setupLog;
const gestures = createGestureTracker();
const drag = createPetDrag({
  getMagnetRects: async () => {
    const bounds = await frontmostWindowBounds().catch(() => null);
    return bounds === null ? [] : [bounds];
  },
});
const timedDisplay = createTimedPetDisplay();
const crawlLocomotion = createCrawlLocomotion();
let interaction: InteractionState | undefined;
let interactionTimer: number | undefined;
let bubblingIntentTimer: number | undefined;
let autoWakeInFlight = false;
let lastAutoWakeAt = 0;
let selectedSetupChannel: SetupChannel = 'feishu';
let setupLanguage: SetupLanguage = 'zh';
let setupView: SetupView = 'choose';
let setupStepIndex = 0;
let loadingTimer: number | undefined;

function shouldAutoWake(snapshot: Awaited<ReturnType<typeof fetchBridgeSnapshot>>): boolean {
  return snapshot.status.bridge !== 'online' || snapshot.status.tunnel !== 'online';
}

function maybeAutoWake(snapshot: Awaited<ReturnType<typeof fetchBridgeSnapshot>>): void {
  const now = Date.now();
  if (!shouldAutoWake(snapshot) || autoWakeInFlight || now - lastAutoWakeAt < 20_000) {
    return;
  }

  lastAutoWakeAt = now;
  autoWakeInFlight = true;
  void ensureDaemon()
    .then(refresh)
    .catch(() => undefined)
    .finally(() => {
      autoWakeInFlight = false;
    });
}

async function refresh(): Promise<void> {
  const snapshot = await fetchBridgeSnapshot().catch(() => offlineSnapshot());
  maybeAutoWake(snapshot);
  const businessState = deriveCrabState({ ...snapshot, interaction });
  const state = timedDisplay.update(businessState);
  crawlLocomotion.setActive(state === 'crawl' || state === 'dodge');
  renderCrabState(crabButton, bubblePanel, state, describeCrabActivity({ state, ...snapshot }));
}

function setInteraction(nextInteraction: InteractionState): void {
  interaction = nextInteraction;
  if (interactionTimer !== undefined) {
    window.clearTimeout(interactionTimer);
  }
  interactionTimer = clearInteractionAfter(nextInteraction, () => {
    interaction = undefined;
    void refresh();
  });
  void refresh();
}

function clearInteraction(): void {
  interaction = undefined;
  if (interactionTimer !== undefined) {
    window.clearTimeout(interactionTimer);
    interactionTimer = undefined;
  }
  void refresh();
}

function cancelBubblingIntent(): void {
  if (bubblingIntentTimer !== undefined) {
    window.clearTimeout(bubblingIntentTimer);
    bubblingIntentTimer = undefined;
  }
}

function startBubblingIntent(): void {
  if (bubblingIntentTimer !== undefined) {
    return;
  }
  bubblingIntentTimer = window.setTimeout(() => {
    bubblingIntentTimer = undefined;
    setInteraction('bubbling');
  }, 5_000);
}

function hideCrabMenu(): void {
  crabMenu.dataset.visible = 'false';
  crabMenu.setAttribute('aria-hidden', 'true');
}

async function setPetWindowSize(size: { width: number; height: number }): Promise<void> {
  document.documentElement.style.setProperty('--pet-window-width', `${size.width}px`);
  document.documentElement.style.setProperty('--pet-window-height', `${size.height}px`);
  await appWindow.setSize(new LogicalSize(size.width, size.height)).catch(() => undefined);
}

function selectedSetupClient(): SetupClient {
  return SETUP_CLIENTS.find((client) => client.channel === selectedSetupChannel) ?? SETUP_CLIENTS[0];
}

function currentSetupStep(): SetupStep {
  const client = selectedSetupClient();
  return client.steps[Math.min(setupStepIndex, client.steps.length - 1)];
}

function text(value: LocalizedText): string {
  return value[setupLanguage];
}

function renderSetupGuide(): void {
  renderSetupLanguageToggle();
  if (setupView === 'choose') {
    renderSetupChooser();
    return;
  }

  const client = selectedSetupClient();
  const step = currentSetupStep();
  setupStepCount.textContent = `${text(client.label)} / ${setupStepIndex + 1} of ${client.steps.length}`;
  setupStepTitle.textContent = text(step.title);
  setupStepBody.textContent = text(step.body);
  setupClients.replaceChildren();
  setupSteps.replaceChildren(...client.steps.map((item, index) => renderSetupStepDot(item, index)));
  setupFields.replaceChildren(...(step.fields ?? []).map(renderSetupField));
  setupOutput.textContent = step.fields?.length
    ? setupLanguage === 'zh'
      ? '把刚刚复制的 key 粘贴到下面。Dardanus 只写入本地配置文件。'
      : 'Paste the keys you just copied. Dardanus only writes the local config file.'
    : text(step.action);
  updateSetupActions();
}

function renderSetupChooser(): void {
  setupStepCount.textContent = 'Dardanus Coach Setup';
  setupStepTitle.textContent = text(SETUP_COPY.chooseTitle);
  setupStepBody.textContent = text(SETUP_COPY.chooseBody);
  setupClients.replaceChildren(...SETUP_CLIENTS.map(renderSetupClientButton));
  setupSteps.replaceChildren();
  setupFields.replaceChildren();
  setupOutput.textContent =
    setupLanguage === 'zh'
      ? '选择一个入口后，Dardanus 会只展示该入口需要做的下一步。'
      : 'Choose one entry point. Dardanus will only show the next step for that channel.';
  updateSetupActions();
}

function renderSetupLanguageToggle(): void {
  setupLanguages.replaceChildren(
    ...(['zh', 'en'] as const).map((language) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.setupLanguage = language;
      button.dataset.selected = String(language === setupLanguage);
      button.textContent = SETUP_COPY.language[language];
      return button;
    }),
  );
}

function renderSetupClientButton(client: SetupClient): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.setupClient = client.channel;
  button.dataset.selected = String(setupView !== 'choose' && client.channel === selectedSetupChannel);
  button.innerHTML = `<strong>${text(client.label)}</strong><span>${text(client.badge)}</span><small>${text(client.intro)}</small>`;
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', String(client.channel === selectedSetupChannel));
  return button;
}

function renderSetupStepDot(step: SetupStep, index: number): HTMLElement {
  const item = document.createElement('li');
  item.dataset.current = String(index === setupStepIndex);
  item.dataset.done = String(index < setupStepIndex);
  item.textContent = text(step.title);
  return item;
}

function renderSetupField(field: SetupField): HTMLElement {
  const label = document.createElement('label');
  label.className = 'setup-field';
  const caption = document.createElement('span');
  caption.textContent = `${text(field.label)}${field.optional ? (setupLanguage === 'zh' ? '（可选）' : ' (optional)') : ''}`;
  const input = document.createElement('input');
  input.name = field.key;
  input.type = field.secret ? 'password' : 'text';
  input.placeholder = text(field.placeholder);
  input.autocomplete = 'off';
  if (!field.optional) {
    input.required = true;
  }
  label.append(caption, input);
  return label;
}

function collectSetupConfig(): Record<string, string> {
  const formData = new FormData(setupFields);
  const config: Record<string, string> = { channel: selectedSetupChannel };
  formData.forEach((value, key) => {
    if (typeof value === 'string' && value.trim()) {
      config[key] = value.trim();
    }
  });
  return config;
}

function startSetupLoading(): void {
  let frame = 0;
  window.clearInterval(loadingTimer);
  setupView = 'loading';
  updateSetupActions();
  loadingTimer = window.setInterval(() => {
    const frames = LOADING_FRAMES[setupLanguage];
    const suffix = setupLanguage === 'zh' ? `正在准备 ${text(selectedSetupClient().label)} 到 Claude Code...` : `Preparing ${text(selectedSetupClient().label)} for Claude Code...`;
    setupOutput.textContent = `${frames[frame % frames.length]}\n${suffix}`;
    frame += 1;
  }, 220);
}

function stopSetupLoading(message: string): void {
  if (loadingTimer !== undefined) {
    window.clearInterval(loadingTimer);
    loadingTimer = undefined;
  }
  setupView = 'coach';
  updateSetupActions();
  setupOutput.textContent = message;
}

async function showSetupGuide(): Promise<void> {
  hideCrabMenu();
  cancelBubblingIntent();
  setupView = 'choose';
  setupStepIndex = 0;
  renderSetupGuide();
  root.dataset.setup = 'true';
  setup.dataset.visible = 'true';
  setup.setAttribute('aria-hidden', 'false');
  localStorage.setItem(ONBOARDING_KEY, 'true');
  await setPetWindowSize(SETUP_WINDOW_SIZE);
}

async function hideSetupGuide(): Promise<void> {
  if (loadingTimer !== undefined) {
    window.clearInterval(loadingTimer);
    loadingTimer = undefined;
  }
  setup.dataset.visible = 'false';
  setup.setAttribute('aria-hidden', 'true');
  root.dataset.setup = 'false';
  await setPetWindowSize(PET_WINDOW_SIZE);
}

function updateSetupActions(): void {
  const back = setup.querySelector<HTMLButtonElement>('[data-setup-action="back"]');
  const guide = setup.querySelector<HTMLButtonElement>('[data-setup-action="open-guide"]');
  const next = setup.querySelector<HTMLButtonElement>('[data-setup-action="next"]');
  const save = setup.querySelector<HTMLButtonElement>('[data-setup-action="save"]');
  const done = setup.querySelector<HTMLButtonElement>('[data-setup-action="done"]');
  const step = setupView === 'coach' ? currentSetupStep() : undefined;
  if (back) {
    back.textContent = text(SETUP_COPY.back);
    back.hidden = setupView === 'loading';
  }
  if (guide) {
    guide.textContent = text(SETUP_COPY.openGuide);
    guide.hidden = setupView !== 'coach' || !step?.guideUrl;
  }
  if (next) {
    next.textContent = setupView === 'choose' ? text(SETUP_COPY.next) : text(SETUP_COPY.next);
    next.hidden = setupView !== 'coach' || setupStepIndex >= selectedSetupClient().steps.length - 1;
  }
  if (save) {
    save.textContent = setupView === 'coach' ? text(SETUP_COPY.connect) : text(SETUP_COPY.connect);
    save.hidden = setupView !== 'coach' || setupStepIndex < selectedSetupClient().steps.length - 1;
  }
  if (done) {
    done.textContent = setupView === 'loading' ? text(SETUP_COPY.finish) : text(SETUP_COPY.done);
  }
}

function maybeShowFirstRunSetup(): void {
  if (localStorage.getItem(ONBOARDING_KEY) === 'true') {
    return;
  }
  window.setTimeout(() => {
    void showSetupGuide();
  }, 700);
}

async function runSetupAction(action: string | undefined): Promise<void> {
  if (action === 'back') {
    if (setupView === 'coach' && setupStepIndex > 0) {
      setupStepIndex -= 1;
    } else {
      setupView = 'choose';
      setupStepIndex = 0;
    }
    renderSetupGuide();
    return;
  }
  if (action === 'next') {
    if (setupView === 'coach') {
      const step = currentSetupStep();
      if (step.fields?.length && !setupFields.reportValidity()) {
        return;
      }
      setupStepIndex = Math.min(selectedSetupClient().steps.length - 1, setupStepIndex + 1);
      renderSetupGuide();
    }
    return;
  }
  if (action === 'open-guide') {
    await openSetupGuide(currentSetupStep().guideUrl ?? selectedSetupClient().guideUrl).catch((error) => {
      stopSetupLoading(error instanceof Error ? error.message : 'Failed to open guide');
    });
    return;
  }
  if (action === 'save') {
    if (!setupFields.reportValidity()) {
      return;
    }
    startSetupLoading();
    try {
      const result = await saveSetupConfig(collectSetupConfig());
      if (selectedSetupChannel === 'feishu' || selectedSetupChannel === 'wecom') {
        await startDaemon();
        stopSetupLoading(`${result}\n${text(SETUP_COPY.loadingDone)}`);
      } else {
        stopSetupLoading(`${result}\n${text(selectedSetupClient().label)} ${setupLanguage === 'zh' ? '已保存为规划中的 Claude Code 通道。' : 'is saved as a planned Claude Code channel.'}`);
      }
      await refresh();
    } catch (error) {
      stopSetupLoading(error instanceof Error ? error.message : 'Setup failed');
    }
    return;
  }
  if (action === 'done') {
    await hideSetupGuide();
  }
}

function showTransientBubble(message: string): void {
  bubblePanel.textContent = message;
  bubblePanel.dataset.visible = 'true';
  window.setTimeout(() => {
    bubblePanel.dataset.visible = 'false';
  }, 4_000);
}

function showCrabMenu(event: MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
  cancelBubblingIntent();
  const appBounds = document.querySelector<HTMLElement>('#app')?.getBoundingClientRect();
  const menuWidth = crabMenu.offsetWidth || 96;
  const menuHeight = crabMenu.offsetHeight || 96;
  const maxLeft = Math.max(0, (appBounds?.width ?? window.innerWidth) - menuWidth - 4);
  const maxTop = Math.max(0, (appBounds?.height ?? window.innerHeight) - menuHeight - 4);
  crabMenu.style.left = `${Math.min(Math.max(4, event.clientX), maxLeft)}px`;
  crabMenu.style.top = `${Math.min(Math.max(4, event.clientY), maxTop)}px`;
  crabMenu.dataset.visible = 'true';
  crabMenu.setAttribute('aria-hidden', 'false');
}

function canStartWindowDrag(event: PointerEvent): boolean {
  if (event.button !== 0) {
    return false;
  }
  const target = event.target;
  if (!(target instanceof Element)) {
    return false;
  }
  return target.closest('button, input, textarea, select, label, form') === null;
}

function setupIsVisible(): boolean {
  return setup.dataset.visible === 'true';
}

async function reloadPetStatus(): Promise<void> {
  cancelBubblingIntent();
  await hideSetupGuide();
  await positionNearDock().catch(() => undefined);
  await refresh();
}

async function wakeBridgeFromSleep(): Promise<void> {
  cancelBubblingIntent();
  showTransientBubble('Waking bridge and tunnel...');
  try {
    await startDaemon();
    await reloadPetStatus();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Wake failed';
    showTransientBubble(message);
  }
}

async function runMenuAction(action: string | undefined): Promise<void> {
  hideCrabMenu();
  if (action === 'wake') {
    await wakeBridgeFromSleep();
    return;
  }
  if (action === 'setup') {
    await showSetupGuide();
    return;
  }
  if (action === 'reload') {
    await reloadPetStatus();
    return;
  }
  if (action === 'quit') {
    await quitApp().catch(() => undefined);
  }
}

crabButton.addEventListener('click', () => {
  hideCrabMenu();
  if (drag.consumeDragClick()) {
    return;
  }

  const gesture = gestures.click();
  if (gesture !== undefined) {
    cancelBubblingIntent();
    setInteraction(gesture);
  }
});

crabButton.addEventListener('contextmenu', (event) => {
  showCrabMenu(event);
});

crabMenu.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  void runMenuAction(target.dataset.menuAction);
});

setup.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const nextLanguage = target.dataset.setupLanguage as SetupLanguage | undefined;
  if (nextLanguage !== undefined) {
    setupLanguage = nextLanguage;
    renderSetupGuide();
    return;
  }
  const setupClient = target.dataset.setupClient as SetupChannel | undefined;
  if (setupClient !== undefined) {
    selectedSetupChannel = setupClient;
    setupView = 'coach';
    setupStepIndex = 0;
    renderSetupGuide();
    return;
  }
  void runSetupAction(target.dataset.setupAction);
});

document.addEventListener('click', (event) => {
  if (event.target instanceof Node && crabMenu.contains(event.target)) {
    return;
  }
  hideCrabMenu();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideCrabMenu();
    void hideSetupGuide();
  }
});

crabButton.addEventListener('pointerenter', () => {
  startBubblingIntent();
});

crabButton.addEventListener('mouseenter', () => {
  startBubblingIntent();
});

crabButton.addEventListener('pointerdown', (event) => {
  startBubblingIntent();
  void drag.pointerDown(event).catch(() => undefined);
});

crabButton.addEventListener('pointermove', (event) => {
  void drag.pointerMove(event).catch(() => undefined);
});

crabButton.addEventListener('pointerup', () => {
  startBubblingIntent();
  void drag.pointerUp().catch(() => undefined);
});

crabButton.addEventListener('pointercancel', () => {
  void drag.pointerUp().catch(() => undefined);
});

crabButton.addEventListener('pointerleave', (event) => {
  if (event.buttons === 0) {
    void drag.pointerUp().catch(() => undefined);
  }
  cancelBubblingIntent();
  if (interaction === 'bubbling') {
    clearInteraction();
  }
});

crabButton.addEventListener('mouseleave', () => {
  cancelBubblingIntent();
  if (interaction === 'bubbling') {
    clearInteraction();
  }
});

root.addEventListener('pointerdown', (event) => {
  if (!setupIsVisible() || !canStartWindowDrag(event)) {
    return;
  }
  void drag.pointerDown(event).catch(() => undefined);
});

root.addEventListener('pointermove', (event) => {
  if (!setupIsVisible()) {
    return;
  }
  void drag.pointerMove(event).catch(() => undefined);
});

root.addEventListener('pointerup', () => {
  if (!setupIsVisible()) {
    return;
  }
  void drag.pointerUp().catch(() => undefined);
});

root.addEventListener('pointercancel', () => {
  if (!setupIsVisible()) {
    return;
  }
  void drag.pointerUp().catch(() => undefined);
});

window.addEventListener('beforeunload', () => {
  crawlLocomotion.stop();
});

void positionNearDock().catch(() => undefined);
void ensureDaemon()
  .catch(() => undefined)
  .finally(() => {
    void refresh();
    maybeShowFirstRunSetup();
  });
window.setInterval(refresh, 1_500);
