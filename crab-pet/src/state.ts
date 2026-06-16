export type CrabState = 'sleep' | 'awake' | 'wave-claw' | 'crawl' | 'wink' | 'bubbling' | 'dodge' | 'shrink' | 'idle-shrink';
export type OnlineState = 'online' | 'offline';
export type ClaudeState = 'idle' | 'processing';
export type MessageType = 'text' | 'file' | 'image' | 'audio' | 'media' | 'post';
export type InteractionState = 'bubbling' | 'crawl' | 'dodge' | 'shrink';

export interface BridgeStatus {
  bridge: OnlineState;
  tunnel: OnlineState;
  claude: ClaudeState;
  lastMessageType: MessageType | null;
  lastEventAt: string | null;
  lastError: string | null;
}

export type BridgeEvent =
  | { type: 'message_received'; messageType: MessageType; summary?: string; at: string }
  | { type: 'claude_started'; at: string }
  | { type: 'claude_completed'; at: string }
  | { type: 'error'; message: string; at: string };

export function deriveCrabState(input: {
  status: BridgeStatus;
  events: BridgeEvent[];
  interaction?: InteractionState;
  now?: Date;
}): CrabState {
  const now = input.now ?? new Date();

  if (input.interaction === 'crawl' || input.interaction === 'dodge' || input.interaction === 'shrink') {
    return input.interaction;
  }

  if (input.status.bridge !== 'online' || input.status.tunnel !== 'online') {
    return 'sleep';
  }

  if (hasRecentNonTextMessage(input.events, now)) {
    return 'wink';
  }

  if (input.status.claude === 'processing') {
    return 'crawl';
  }

  if (input.interaction === 'bubbling' || hasRecentCompletion(input.events, now)) {
    return 'bubbling';
  }

  return 'awake';
}

function hasRecentNonTextMessage(events: BridgeEvent[], now: Date): boolean {
  return events.some((event) => event.type === 'message_received' && event.messageType !== 'text' && isRecent(event.at, now, 5_000));
}

function hasRecentCompletion(events: BridgeEvent[], now: Date): boolean {
  return events.some((event) => event.type === 'claude_completed' && isRecent(event.at, now, 5_000));
}

function isRecent(isoTime: string, now: Date, windowMs: number): boolean {
  const ageMs = now.getTime() - new Date(isoTime).getTime();
  return ageMs >= 0 && ageMs <= windowMs;
}
