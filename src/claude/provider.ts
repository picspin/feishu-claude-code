import { query, type Options, type CanUseTool, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';

export interface QueryOptions {
  prompt: string;
  cwd: string;
  resume?: string;
  model?: string;
  systemPrompt?: string;
  recoveryContext?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  onPermissionRequest?: (toolName: string, toolInput: string) => Promise<boolean>;
}

export interface QueryResult {
  text: string;
  sessionId: string;
  recoveredFromContextOverflow?: boolean;
}

type QueryFactory = typeof query;

class ClaudeQueryFailure extends Error {
  constructor(
    message: string,
    readonly details: string,
  ) {
    super(message);
    this.name = 'ClaudeQueryFailure';
  }
}

const CONTEXT_OVERFLOW_PATTERN = /prompt is too long|context (?:window|length).*(?:exceed|too long)|maximum context length|too many tokens/i;

function messageText(message: unknown): string {
  if (typeof message !== 'object' || message === null || !('message' in message)) {
    return '';
  }
  const payload = message.message;
  if (typeof payload !== 'object' || payload === null || !('content' in payload) || !Array.isArray(payload.content)) {
    return '';
  }
  return payload.content
    .filter((block: unknown): block is { type: 'text'; text: string } => {
      return typeof block === 'object'
        && block !== null
        && 'type' in block
        && 'text' in block
        && block.type === 'text'
        && typeof block.text === 'string';
    })
    .map((block) => block.text)
    .join('');
}

function recoveryPrompt(prompt: string, context?: string): string {
  if (!context?.trim()) {
    return prompt;
  }
  return [
    'The previous Claude Code session exceeded the model context window.',
    'Continue the task in a fresh session. Inspect the current working tree before changing files.',
    'Recent bridge conversation (may be incomplete):',
    context.trim(),
    'Current user request:',
    prompt,
  ].join('\n\n');
}

async function runQuery(
  options: QueryOptions,
  queryFactory: QueryFactory,
  prompt: string,
  resume?: string,
): Promise<QueryResult> {
  const sdkOptions: Options = {
    cwd: options.cwd,
    permissionMode: options.permissionMode,
    allowDangerouslySkipPermissions: options.permissionMode === 'bypassPermissions',
    settingSources: ['user', 'project'],
  };

  if (options.model) {
    sdkOptions.model = options.model;
  }
  if (resume) {
    sdkOptions.resume = resume;
  }
  if (options.systemPrompt) {
    (sdkOptions as Options & { systemPrompt?: { type: 'preset'; preset: 'claude_code'; append: string } }).systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      append: options.systemPrompt,
    };
  }

  if (options.onPermissionRequest) {
    const canUseTool: CanUseTool = async (toolName, input): Promise<PermissionResult> => {
      const allowed = await options.onPermissionRequest?.(toolName, JSON.stringify(input));
      if (allowed) {
        return { behavior: 'allow', updatedInput: input };
      }
      return { behavior: 'deny', message: 'Permission denied by Feishu user.', interrupt: true };
    };
    sdkOptions.canUseTool = canUseTool;
  }

  const stderr: string[] = [];
  sdkOptions.stderr = (data) => {
    stderr.push(data);
    if (stderr.length > 40) {
      stderr.shift();
    }
  };

  const result = queryFactory({ prompt, options: sdkOptions });
  let text = '';
  let apiError = '';
  let sessionId = resume ?? '';

  try {
    for await (const message of result) {
      if ('session_id' in message && message.session_id) {
        sessionId = message.session_id;
      }
      if (message.type === 'assistant') {
        const chunk = messageText(message);
        const errorMessage = message as typeof message & { error?: unknown; isApiErrorMessage?: boolean };
        if (errorMessage.isApiErrorMessage || errorMessage.error) {
          apiError += chunk;
        } else {
          text += chunk;
        }
      }
    }
  } catch (error) {
    const processError = error instanceof Error ? error.message : String(error);
    const diagnostic = [apiError.trim(), processError, stderr.join('').trim()]
      .filter(Boolean)
      .join('\n')
      .slice(-4000);
    throw new ClaudeQueryFailure(apiError.trim() || processError, diagnostic);
  }

  if (apiError.trim()) {
    throw new ClaudeQueryFailure(apiError.trim(), apiError.trim());
  }

  return { text: text.trim(), sessionId };
}

export async function claudeQuery(
  options: QueryOptions,
  queryFactory: QueryFactory = query,
): Promise<QueryResult> {
  try {
    return await runQuery(options, queryFactory, options.prompt, options.resume);
  } catch (error) {
    const details = error instanceof ClaudeQueryFailure
      ? error.details
      : error instanceof Error ? error.message : String(error);
    if (!options.resume || !CONTEXT_OVERFLOW_PATTERN.test(details)) {
      throw error;
    }

    const recovered = await runQuery(
      options,
      queryFactory,
      recoveryPrompt(options.prompt, options.recoveryContext),
    );
    return { ...recovered, recoveredFromContextOverflow: true };
  }
}
