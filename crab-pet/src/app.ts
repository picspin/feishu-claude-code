import { fetchBridgeSnapshot, offlineSnapshot } from './bridge-client.js';
import { describeCrabActivity } from './activity.js';
import { renderCrabState } from './crab.js';
import { createGestureTracker } from './gestures.js';
import { clearInteractionAfter } from './animation.js';
import { deriveCrabState, type InteractionState } from './state.js';
import { createHorizontalPetDrag } from './drag.js';
import { createTimedPetDisplay } from './display-state.js';
import { createCrawlLocomotion } from './locomotion.js';
import { ensureDaemon, positionNearDock, stopDaemon } from './tauri.js';

const button = document.querySelector<HTMLElement>('#crab-button');
const panel = document.querySelector<HTMLElement>('#bubble-panel');

if (!button || !panel) {
  throw new Error('Crab UI did not mount');
}

const crabButton = button;
const bubblePanel = panel;
const gestures = createGestureTracker();
const drag = createHorizontalPetDrag();
const timedDisplay = createTimedPetDisplay();
const crawlLocomotion = createCrawlLocomotion();
let interaction: InteractionState | undefined;
let interactionTimer: number | undefined;
let bubblingIntentTimer: number | undefined;

async function refresh(): Promise<void> {
  const snapshot = await fetchBridgeSnapshot().catch(() => offlineSnapshot());
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

async function wakeBridgeFromSleep(): Promise<void> {
  cancelBubblingIntent();
  await ensureDaemon().catch(() => undefined);
  await positionNearDock().catch(() => undefined);
  await refresh();
}

crabButton.addEventListener('click', () => {
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
  event.preventDefault();
  void wakeBridgeFromSleep();
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
  void stopDaemon().catch(() => undefined);
});

void positionNearDock().catch(() => undefined);
void ensureDaemon()
  .catch(() => undefined)
  .finally(() => {
    void refresh();
  });
window.setInterval(refresh, 1_500);
