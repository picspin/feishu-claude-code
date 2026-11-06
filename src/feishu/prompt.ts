import type { SavedArtifact } from './artifacts.js';
import type { FeishuIncomingMessage } from './webhook.js';
import { buildPromptFromParts } from '../core/prompt.js';

export function buildPrompt(message: FeishuIncomingMessage, artifacts: SavedArtifact[]): string {
  return buildPromptFromParts(
    {
      text: message.text,
      links: message.links,
    },
    artifacts,
  );
}
