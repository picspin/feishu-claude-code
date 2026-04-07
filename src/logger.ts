import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LOG_PATH } from './constants.js';

function write(level: string, message: string, meta?: Record<string, unknown>): void {
  const line = `${new Date().toISOString()} [${level}] ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}\n`;
  mkdirSync(dirname(LOG_PATH), { recursive: true });
  appendFileSync(LOG_PATH, line);
  if (level === 'ERROR') {
    console.error(line.trim());
    return;
  }
  console.log(line.trim());
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    write('INFO', message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>) {
    write('WARN', message, meta);
  },
  error(message: string, meta?: Record<string, unknown>) {
    write('ERROR', message, meta);
  },
};
