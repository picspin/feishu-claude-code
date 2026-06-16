import type { InteractionState } from './state.js';

export interface GestureTracker {
  click(nowMs?: number): InteractionState | undefined;
}

export function createGestureTracker(options?: {
  doubleClickMs?: number;
  burstWindowMs?: number;
}): GestureTracker {
  const doubleClickMs = options?.doubleClickMs ?? 350;
  const burstWindowMs = options?.burstWindowMs ?? 900;
  let clicks: number[] = [];

  return {
    click(nowMs = Date.now()) {
      clicks = clicks.filter((clickedAt) => nowMs - clickedAt <= burstWindowMs);
      clicks.push(nowMs);

      if (clicks.length > 3) {
        clicks = [];
        return 'shrink';
      }

      const previousClick = clicks.at(-2);
      if (previousClick !== undefined && nowMs - previousClick <= doubleClickMs) {
        return 'crawl';
      }

      return 'bubbling';
    },
  };
}
