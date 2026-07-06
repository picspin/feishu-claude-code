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
import { ensureDaemon, positionNearDock, quitApp, startDaemon } from './tauri.js';

const PET_WINDOW_SIZE = { width: 160, height: 124 };
const SETUP_WINDOW_SIZE = { width: 360, height: 396 };
const ONBOARDING_KEY = 'dardanus-onboarding-seen-v1';
const SETUP_STEPS = [
  {
    title: 'Create a Feishu/Lark bot',
    body: 'Open the Feishu or Lark developer console, create an internal app, then enable bot message receive and send permissions.',
    command: 'https://open.feishu.cn/',
  },
  {
    title: 'Enable event subscription',
    body: 'Subscribe to im.message.receive_v1 and set the request URL to your Dardanus Cloudflare tunnel webhook.',
    command: 'https://feishu.hilbert-space.store/feishu/webhook',
  },
  {
    title: 'Save bridge secrets',
    body: 'Run the setup script or fill the local config with your App ID, App Secret, verification token, and optional encrypt key.',
    command: 'npm run setup',
  },
  {
    title: 'Wake Dardanus',
    body: 'Use Wake after setup. Dardanus starts the bridge daemon and tunnel, then switches from sleep to awake when both are healthy.',
    command: 'Right click Dardanus -> Wake',
  },
  {
    title: 'Next: QR IM channels',
    body: 'WeChat and WeCom can join later through OpenClaw-style QR login adapters while reusing the same pet states.',
    command: 'openclaw channels login --channel openclaw-weixin',
  },
];

const appWindow = getCurrentWindow();
const button = document.querySelector<HTMLElement>('#crab-button');
const panel = document.querySelector<HTMLElement>('#bubble-panel');
const menu = document.querySelector<HTMLElement>('#crab-menu');
const appRoot = document.querySelector<HTMLElement>('#app');
const setupPanel = document.querySelector<HTMLElement>('#setup-panel');
const setupCount = document.querySelector<HTMLElement>('#setup-count');
const setupTitle = document.querySelector<HTMLElement>('#setup-title');
const setupBody = document.querySelector<HTMLElement>('#setup-body');
const setupCommand = document.querySelector<HTMLElement>('#setup-command');

if (!button || !panel || !menu || !appRoot || !setupPanel || !setupCount || !setupTitle || !setupBody || !setupCommand) {
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
const setupStepCommand = setupCommand;
const gestures = createGestureTracker();
const drag = createPetDrag();
const timedDisplay = createTimedPetDisplay();
const crawlLocomotion = createCrawlLocomotion();
let interaction: InteractionState | undefined;
let interactionTimer: number | undefined;
let bubblingIntentTimer: number | undefined;
let autoWakeInFlight = false;
let lastAutoWakeAt = 0;
let setupStepIndex = 0;

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

function renderSetupStep(): void {
  const step = SETUP_STEPS[setupStepIndex];
  setupStepCount.textContent = `Step ${setupStepIndex + 1} of ${SETUP_STEPS.length}`;
  setupStepTitle.textContent = step.title;
  setupStepBody.textContent = step.body;
  setupStepCommand.textContent = step.command;
}

async function showSetupGuide(): Promise<void> {
  hideCrabMenu();
  cancelBubblingIntent();
  setupStepIndex = 0;
  renderSetupStep();
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
  if (action === 'previous') {
    setupStepIndex = Math.max(0, setupStepIndex - 1);
    renderSetupStep();
    return;
  }
  if (action === 'next') {
    setupStepIndex = Math.min(SETUP_STEPS.length - 1, setupStepIndex + 1);
    renderSetupStep();
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
  drag.pointerUp();
});

crabButton.addEventListener('pointercancel', () => {
  drag.pointerUp();
});

crabButton.addEventListener('pointerleave', (event) => {
  if (event.buttons === 0) {
    drag.pointerUp();
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
