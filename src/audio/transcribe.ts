import { execFile } from 'node:child_process';
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

export async function transcribeAudio(localPath: string, commandTemplate?: string): Promise<AudioTranscriptionResult> {
  if (!commandTemplate?.trim()) {
    return {};
  }

  const escapedPath = localPath.replace(/'/g, `'"'"'`);
  const command = commandTemplate.includes('{file}')
    ? commandTemplate.replaceAll('{file}', `'${escapedPath}'`)
    : `${commandTemplate} '${escapedPath}'`;

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
    return {
      text,
      source: commandTemplate.split(/\s+/)[0],
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
