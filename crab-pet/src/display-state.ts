import type { CrabState } from './state.js';

const WAVE_INTERVAL_MS = 60_000;
const WAVE_DURATION_MS = 5_000;
const AWAKE_IDLE_SHRINK_MS = 300_000;

export function createTimedPetDisplay(): {
  update: (businessState: CrabState, nowMs?: number) => CrabState;
} {
  let awakeSinceMs: number | undefined;

  function update(businessState: CrabState, nowMs = Date.now()): CrabState {
    if (businessState !== 'awake') {
      awakeSinceMs = undefined;
      return businessState;
    }

    awakeSinceMs ??= nowMs;
    const awakeForMs = nowMs - awakeSinceMs;
    if (awakeForMs >= AWAKE_IDLE_SHRINK_MS) {
      return 'idle-shrink';
    }

    const completedIntervals = Math.floor(awakeForMs / WAVE_INTERVAL_MS);
    const intervalRemainderMs = awakeForMs - completedIntervals * WAVE_INTERVAL_MS;
    if (completedIntervals >= 1 && intervalRemainderMs < WAVE_DURATION_MS) {
      return 'wave-claw';
    }

    return 'awake';
  }

  return { update };
}
