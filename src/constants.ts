import { homedir } from 'node:os';
import { join } from 'node:path';

export const DATA_DIR = join(homedir(), '.feishu-claude-code');
export const CONFIG_PATH = join(DATA_DIR, 'config.json');
export const SESSIONS_DIR = join(DATA_DIR, 'sessions');
export const RUNTIME_DIR = join(DATA_DIR, 'runtime');
export const LOG_PATH = join(DATA_DIR, 'daemon.log');
