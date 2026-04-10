import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AudioTranscriptionResult {
  text?: string;
  source?: string;
  error?: string;
}

function buildShellInvocation(command: string): { file: string; args: string[] } {
  return {
    file: '/bin/sh',
    args: ['-lc', command],
  };
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function runCommand(command: string, source: string): Promise<AudioTranscriptionResult> {
  try {
    const invocation = buildShellInvocation(command);
    const { stdout } = await execFileAsync(invocation.file, invocation.args, {
      timeout: 5 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const text = stdout.trim();
    if (!text) {
      return { error: 'Transcription command returned empty output.' };
    }
    return { text, source };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function extractAudioTrack(localPath: string): Promise<{ extractedPath?: string; error?: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'feishu-media-'));
  const extractedPath = join(directory, 'audio.m4a');
  const command = `ffmpeg -y -i ${quoteShellArg(localPath)} -vn -acodec aac ${quoteShellArg(extractedPath)}`;
  try {
    const invocation = buildShellInvocation(command);
    await execFileAsync(invocation.file, invocation.args, {
      timeout: 5 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { extractedPath };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function transcribeAudio(localPath: string, commandTemplate?: string, mode: 'audio' | 'media' = 'audio'): Promise<AudioTranscriptionResult> {
  if (!commandTemplate?.trim()) {
    return {};
  }

  const directCommand = commandTemplate.includes('{file}')
    ? commandTemplate.replaceAll('{file}', quoteShellArg(localPath))
    : `${commandTemplate} ${quoteShellArg(localPath)}`;
  const directResult = await runCommand(directCommand, commandTemplate.split(/\s+/)[0]);
  if (directResult.text || mode !== 'media') {
    return directResult;
  }

  const extracted = await extractAudioTrack(localPath);
  if (!extracted.extractedPath) {
    return {
      error: `Direct transcription failed: ${directResult.error || 'unknown error'}; ffmpeg extraction failed: ${extracted.error || 'unknown error'}`,
    };
  }

  const extractedCommand = commandTemplate.includes('{file}')
    ? commandTemplate.replaceAll('{file}', quoteShellArg(extracted.extractedPath))
    : `${commandTemplate} ${quoteShellArg(extracted.extractedPath)}`;
  const extractedResult = await runCommand(extractedCommand, `${commandTemplate.split(/\s+/)[0]}+ffmpeg`);
  if (extractedResult.text) {
    return extractedResult;
  }
  return {
    error: `Direct transcription failed: ${directResult.error || 'unknown error'}; extracted-audio transcription failed: ${extractedResult.error || 'unknown error'}`,
  };
}
