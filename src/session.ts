import { join } from 'node:path';
import { SESSIONS_DIR } from './constants.js';
import { loadJson, saveJson } from './store.js';

export type SessionState = 'idle' | 'processing' | 'waiting_permission';
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Session {
  sdkSessionId?: string;
  workingDirectory: string;
  model?: string;
  permissionMode?: PermissionMode;
  state: SessionState;
  chatHistory: ChatMessage[];
}

function sessionPath(sessionId: string): string {
  return join(SESSIONS_DIR, `${sessionId}.json`);
}

export function createSessionStore() {
  function load(sessionId: string): Session {
    return loadJson(sessionPath(sessionId), {
      workingDirectory: process.cwd(),
      state: 'idle',
      chatHistory: [],
    } satisfies Session);
  }

  function save(sessionId: string, session: Session): void {
    saveJson(sessionPath(sessionId), session);
  }

  function addChatMessage(session: Session, role: 'user' | 'assistant', content: string): void {
    session.chatHistory.push({ role, content, timestamp: Date.now() });
    if (session.chatHistory.length > 100) {
      session.chatHistory = session.chatHistory.slice(-100);
    }
  }

  return { load, save, addChatMessage };
}
