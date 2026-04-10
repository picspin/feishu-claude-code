import { extname } from 'node:path';
import type { SavedArtifact } from './artifacts.js';
import type { FeishuIncomingMessage } from './webhook.js';

type AttachmentCategory = 'image' | 'audio' | 'pdf' | 'textLike' | 'officeDoc' | 'genericBinary';

function classifyArtifact(artifact: SavedArtifact): AttachmentCategory {
  const extension = extname(artifact.displayName).toLowerCase();
  const mimeType = (artifact.mimeType || '').toLowerCase();

  if (artifact.kind === 'image' || mimeType.startsWith('image/')) {
    return 'image';
  }
  if (artifact.kind === 'audio' || artifact.kind === 'media' || mimeType.startsWith('audio/') || mimeType.startsWith('video/')) {
    return 'audio';
  }
  if (extension === '.pdf' || mimeType === 'application/pdf') {
    return 'pdf';
  }
  if (['.md', '.txt', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx', '.py', '.yml', '.yaml', '.html', '.css'].includes(extension)
    || mimeType.startsWith('text/')) {
    return 'textLike';
  }
  if (['.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx'].includes(extension)) {
    return 'officeDoc';
  }
  return 'genericBinary';
}

function describeArtifact(artifact: SavedArtifact): string {
  const metadata = [artifact.kind, artifact.mimeType, artifact.size ? `${artifact.size} bytes` : undefined]
    .filter((value): value is string => !!value)
    .join(', ');
  const transcript = artifact.transcriptText
    ? `\n  transcript (${artifact.transcriptSource || 'local-asr'}): ${artifact.transcriptText}`
    : artifact.kind === 'audio'
      ? `\n  transcript: unavailable${artifact.transcriptSource ? ` (${artifact.transcriptSource})` : ''}`
      : '';
  return `- ${artifact.displayName}: ${artifact.localPath}${metadata ? ` (${metadata})` : ''}${transcript}`;
}

function buildHandlingGuidance(artifacts: SavedArtifact[]): string[] {
  const categories = new Set(artifacts.map(classifyArtifact));
  const guidance = [
    'Use the saved local attachment paths below when the answer depends on the attached materials.',
    'Do not assume attachment contents without inspecting the relevant local file first.',
  ];

  if (categories.has('image')) {
    guidance.push('For image attachments, inspect the visual content directly with available image-analysis capability before answering if the request depends on what is shown.');
  }
  if (categories.has('audio')) {
    guidance.push('For audio attachments, use any included transcript as extracted text that may contain recognition errors; if the answer depends on exact wording, mention uncertainty and refer back to the saved local audio file.');
  }
  if (categories.has('pdf')) {
    guidance.push('For PDF attachments, read the PDF directly from the local path; if the document is large, focus on the most relevant pages or use an available PDF-reading skill/capability.');
  }
  if (categories.has('textLike')) {
    guidance.push('For text-like attachments such as Markdown, code, JSON, CSV, or plain text, read the local file contents directly before answering.');
  }
  if (categories.has('officeDoc')) {
    guidance.push('For office documents, try to inspect the local file directly; if the current environment cannot extract the content cleanly, explain that limitation instead of guessing.');
  }
  if (categories.has('genericBinary')) {
    guidance.push('For unsupported or binary attachments, state any format limitations clearly and avoid inventing contents you could not inspect.');
  }

  return guidance;
}

export function buildPrompt(message: FeishuIncomingMessage, artifacts: SavedArtifact[]): string {
  const sections: string[] = [];

  if (message.text) {
    sections.push(['User request:', message.text.trim()].join('\n'));
  }

  if (message.links.length > 0) {
    sections.push([
      'Related links:',
      ...message.links.map((link) => `- ${link}`),
      'Treat these links as supplemental context. Prefer attached local files when the user request is about the uploaded materials.',
    ].join('\n'));
  }

  if (artifacts.length > 0) {
    const categories = Array.from(new Set(artifacts.map(classifyArtifact)));
    sections.push([
      'Attachment summary:',
      `- Count: ${artifacts.length}`,
      `- Categories: ${categories.join(', ')}`,
    ].join('\n'));

    sections.push([
      'Attached files saved locally:',
      ...artifacts.map(describeArtifact),
    ].join('\n'));

    sections.push(['Attachment handling guidance:', ...buildHandlingGuidance(artifacts).map((line) => `- ${line}`)].join('\n'));
  }

  return sections.filter(Boolean).join('\n\n').trim();
}
