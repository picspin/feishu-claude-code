import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { RUNTIME_DIR } from '../constants.js';

export type ArtifactKind = 'file' | 'image' | 'audio' | 'media';

export interface SavedArtifact {
  kind: ArtifactKind;
  localPath: string;
  displayName: string;
  mimeType?: string;
  size?: number;
  transcriptText?: string;
  transcriptSource?: string;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function sanitizeFileName(fileName: string, fallbackBase: string): string {
  const base = basename(fileName || fallbackBase);
  const extension = extname(base);
  const name = extension ? base.slice(0, -extension.length) : base;
  const safeName = sanitizeSegment(name) || sanitizeSegment(fallbackBase);
  const safeExtension = extension && /^[.][a-zA-Z0-9]{1,10}$/.test(extension) ? extension.toLowerCase() : '';
  return `${safeName}${safeExtension}`;
}

export function saveArtifact(params: {
  chatId: string;
  messageId: string;
  kind: ArtifactKind;
  fileName?: string;
  content: Buffer;
  fallbackExtension?: string;
  mimeType?: string;
}): SavedArtifact {
  const directory = join(RUNTIME_DIR, sanitizeSegment(params.chatId), sanitizeSegment(params.messageId));
  mkdirSync(directory, { recursive: true });

  const requestedName = params.fileName?.trim();
  const fallbackBase = `${params.kind}${params.fallbackExtension || ''}`;
  let finalName = sanitizeFileName(requestedName || fallbackBase, fallbackBase);
  if (!extname(finalName) && params.fallbackExtension) {
    finalName = `${finalName}${params.fallbackExtension}`;
  }

  const localPath = join(directory, finalName);
  writeFileSync(localPath, params.content);

  return {
    kind: params.kind,
    localPath,
    displayName: finalName,
    mimeType: params.mimeType,
    size: params.content.byteLength,
  };
}
