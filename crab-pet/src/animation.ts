import type { InteractionState } from './state.js';

export function interactionDurationMs(state: InteractionState): number {
  if (state === 'shrink') {
    return 10_000;
  }
  if (state === 'bubbling' || state === 'crawl' || state === 'dodge') {
    return 5_000;
  }
  return 900;
}

export function clearInteractionAfter(state: InteractionState, onClear: () => void): number {
  return window.setTimeout(onClear, interactionDurationMs(state));
}
