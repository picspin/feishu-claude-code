import { mkdirSync } from 'node:fs';
import { CONFIG_PATH, DATA_DIR } from './constants.js';
import { loadJson, saveJson } from './store.js';

export interface Config {
  port: number;
  webhookPath: string;
  publicBaseUrl?: string;
  workingDirectory: string;
  model?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  systemPrompt?: string;
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
}

const defaultConfig: Config = {
  port: 8787,
  webhookPath: '/feishu/webhook',
  workingDirectory: process.cwd(),
  permissionMode: 'default',
};

export function loadConfig(): Config {
  mkdirSync(DATA_DIR, { recursive: true });
  return loadJson(CONFIG_PATH, defaultConfig);
}

export function saveConfig(config: Config): void {
  mkdirSync(DATA_DIR, { recursive: true });
  saveJson(CONFIG_PATH, config);
}
