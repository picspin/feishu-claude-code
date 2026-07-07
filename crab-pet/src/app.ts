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
import { ensureDaemon, openSetupGuide, positionNearDock, quitApp, saveSetupConfig, startDaemon } from './tauri.js';

const PET_WINDOW_SIZE = { width: 160, height: 124 };
const SETUP_WINDOW_SIZE = { width: 460, height: 560 };
const ONBOARDING_KEY = 'dardanus-onboarding-seen-v1';
type SetupChannel = 'feishu' | 'wechat' | 'wecom';
interface SetupField {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  optional?: boolean;
}
interface SetupClient {
  channel: SetupChannel;
  label: string;
  title: string;
  body: string;
  guideUrl: string;
  status: string;
  fields: SetupField[];
}

const SETUP_CLIENTS: SetupClient[] = [
  {
    channel: 'feishu',
    label: 'Feishu / Lark',
    title: 'Connect Feishu/Lark to Claude Code',
    body: 'Create a Feishu or Lark bot, paste its app credentials here, then Dardanus writes the local bridge config and wakes the daemon.',
    guideUrl: 'https://open.feishu.cn/',
    status: 'Ready',
    fields: [
      { key: 'appId', label: 'App ID', placeholder: 'cli_a...' },
      { key: 'appSecret', label: 'App Secret', placeholder: 'Paste app secret', secret: true },
      { key: 'verificationToken', label: 'Verification Token', placeholder: 'Paste event token', optional: true },
      { key: 'encryptKey', label: 'Encrypt Key', placeholder: 'Optional encrypted event key', secret: true, optional: true },
      { key: 'publicBaseUrl', label: 'Public Base URL', placeholder: 'https://feishu.hilbert-space.store', optional: true },
    ],
  },
  {
    channel: 'wechat',
    label: 'WeChat',
    title: 'Prepare WeChat Claude Code bridge',
    body: 'Dardanus will keep the same Claude Code bridge shape. WeChat support is planned as a QR-login channel bundle, not an OpenClaw plugin dependency.',
    guideUrl: 'https://github.com/Tencent/openclaw-weixin',
    status: 'Planned',
    fields: [
      { key: 'displayName', label: 'Channel Name', placeholder: 'My WeChat bridge' },
      { key: 'callbackUrl', label: 'Callback URL', placeholder: 'Optional local callback URL', optional: true },
    ],
  },
  {
    channel: 'wecom',
    label: 'WeCom',
    title: 'Prepare WeCom Claude Code bridge',
    body: 'Dardanus will expose WeCom as a future enterprise IM channel for Claude Code sessions with a unified setup flow.',
    guideUrl: 'https://github.com/WecomTeam/wecom-openclaw-plugin',
    status: 'Planned',
    fields: [
      { key: 'displayName', label: 'Channel Name', placeholder: 'My WeCom bridge' },
      { key: 'callbackUrl', label: 'Callback URL', placeholder: 'Optional enterprise callback URL', optional: true },
    ],
  },
];
const LOADING_FRAMES = ['[|] checking keys', '[/] writing config', '[-] waking bridge', '[\\] waiting for tunnel'];

const appWindow = getCurrentWindow();
const button = document.querySelector<HTMLElement>('#crab-button');
const panel = document.querySelector<HTMLElement>('#bubble-panel');
const menu = document.querySelector<HTMLElement>('#crab-menu');
const appRoot = document.querySelector<HTMLElement>('#app');
const setupPanel = document.querySelector<HTMLElement>('#setup-panel');
const setupCount = document.querySelector<HTMLElement>('#setup-count');
const setupTitle = document.querySelector<HTMLElement>('#setup-title');
const setupBody = document.querySelector<HTMLElement>('#setup-body');
const setupClientList = document.querySelector<HTMLElement>('#setup-client-list');
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
  !setupClientList ||
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
const setupClients = setupClientList;
const setupFields = setupForm;
const setupOutput = setupLog;
const gestures = createGestureTracker();
const drag = createPetDrag();
const timedDisplay = createTimedPetDisplay();
const crawlLocomotion = createCrawlLocomotion();
let interaction: InteractionState | undefined;
let interactionTimer: number | undefined;
let bubblingIntentTimer: number | undefined;
let autoWakeInFlight = false;
let lastAutoWakeAt = 0;
let selectedSetupChannel: SetupChannel = 'feishu';
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

function renderSetupGuide(): void {
  const client = selectedSetupClient();
  setupStepCount.textContent = `Dardanus Claude Code bridge / ${client.status}`;
  setupStepTitle.textContent = client.title;
  setupStepBody.textContent = client.body;
  setupClients.replaceChildren(...SETUP_CLIENTS.map(renderSetupClientButton));
  setupFields.replaceChildren(...client.fields.map(renderSetupField));
  setupOutput.textContent =
    client.channel === 'feishu'
      ? `Webhook path: /feishu/webhook\nPaste credentials copied from the developer console.`
      : `This reserves a ${client.label} channel profile for the future Claude Code bundle.`;
}

function renderSetupClientButton(client: SetupClient): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.setupClient = client.channel;
  button.dataset.selected = String(client.channel === selectedSetupChannel);
  button.textContent = client.label;
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', String(client.channel === selectedSetupChannel));
  return button;
}

function renderSetupField(field: SetupField): HTMLElement {
  const label = document.createElement('label');
  label.className = 'setup-field';
  const caption = document.createElement('span');
  caption.textContent = `${field.label}${field.optional ? ' (optional)' : ''}`;
  const input = document.createElement('input');
  input.name = field.key;
  input.type = field.secret ? 'password' : 'text';
  input.placeholder = field.placeholder;
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
  loadingTimer = window.setInterval(() => {
    setupOutput.textContent = `${LOADING_FRAMES[frame % LOADING_FRAMES.length]}\nPreparing ${selectedSetupClient().label} for Claude Code...`;
    frame += 1;
  }, 220);
}

function stopSetupLoading(message: string): void {
  if (loadingTimer !== undefined) {
    window.clearInterval(loadingTimer);
    loadingTimer = undefined;
  }
  setupOutput.textContent = message;
}

async function showSetupGuide(): Promise<void> {
  hideCrabMenu();
  cancelBubblingIntent();
  renderSetupGuide();
  root.dataset.setup = 'true';
  setup.dataset.visible = 'true';
  setup.setAttribute('aria-hidden', 'false');
  localStorage.setItem(ONBOARDING_KEY, 'true');
  await setPetWindowSize(SETUP_WINDOW_SIZE);
}

async function hideSetupGuide(): Promise<void> {
  setup.dataset.visible = 'false';
  setup.setAttribute('aria-hidden', 'true');
  root.dataset.setup = 'false';
  await setPetWindowSize(PET_WINDOW_SIZE);
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
  if (action === 'open-guide') {
    await openSetupGuide(selectedSetupClient().guideUrl).catch((error) => {
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
      if (selectedSetupChannel === 'feishu') {
        await startDaemon();
        stopSetupLoading(`${result}\nBridge wake requested. Dardanus will switch state when bridge and tunnel are healthy.`);
      } else {
        stopSetupLoading(`${result}\n${selectedSetupClient().label} is saved as a planned Claude Code channel.`);
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
  const setupClient = target.dataset.setupClient as SetupChannel | undefined;
  if (setupClient !== undefined) {
    selectedSetupChannel = setupClient;
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
