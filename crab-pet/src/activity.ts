import type { BridgeEvent, BridgeStatus, CrabState } from './state.js';

const stateFallbacks: Record<CrabState, string> = {
  sleep: 'Bridge or tunnel offline',
  awake: 'Phone-side Feishu is ready',
  'wave-claw': 'Phone-side Feishu is ready',
  crawl: 'Claude is thinking',
  wink: 'Received non-text input',
  bubbling: 'Reply completed',
  dodge: 'Scuttling away',
  shrink: 'Hiding in shell',
  'idle-shrink': 'Resting in shell',
};

export function describeCrabActivity(input: {
  state: CrabState;
  status: BridgeStatus;
  events: BridgeEvent[];
}): string {
  const latestEvent = input.events.at(-1);

  if (latestEvent?.type === 'error') {
    return latestEvent.message;
  }

  if (input.status.lastError && input.state === 'sleep') {
    return input.status.lastError;
  }

  if (latestEvent?.type === 'claude_completed') {
    return 'Reply completed';
  }

  if (latestEvent?.type === 'message_received') {
    if (latestEvent.summary) {
      return latestEvent.summary;
    }
    return latestEvent.messageType === 'text'
      ? 'Received text message'
      : `Received ${latestEvent.messageType} input`;
  }

  return stateFallbacks[input.state];
}

export function labelForCrabState(state: CrabState): string {
  return stateFallbacks[state];
}
