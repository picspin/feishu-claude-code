import { query, type Options, type CanUseTool, type PermissionResult } from '@anthropic-ai/claude-agent-sdk';

export interface QueryOptions {
  prompt: string;
  cwd: string;
  resume?: string;
  model?: string;
  systemPrompt?: string;
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
  onPermissionRequest?: (toolName: string, toolInput: string) => Promise<boolean>;
}

export interface QueryResult {
  text: string;
  sessionId: string;
}

export async function claudeQuery(options: QueryOptions): Promise<QueryResult> {
  const sdkOptions: Options = {
    cwd: options.cwd,
    permissionMode: options.permissionMode,
    allowDangerouslySkipPermissions: options.permissionMode === 'bypassPermissions',
    settingSources: ['user', 'project'],
  };

  if (options.model) {
    sdkOptions.model = options.model;
  }
  if (options.resume) {
    sdkOptions.resume = options.resume;
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

  const result = query({ prompt: options.prompt, options: sdkOptions });
  let text = '';
  let sessionId = options.resume ?? '';

  for await (const message of result) {
    if ('session_id' in message && message.session_id) {
      sessionId = message.session_id;
    }
    if (message.type === 'assistant' && Array.isArray(message.message?.content)) {
      text += message.message.content
        .filter((block: unknown): block is { type: 'text'; text: string } => {
          return typeof block === 'object'
            && block !== null
            && 'type' in block
            && 'text' in block
            && block.type === 'text'
            && typeof block.text === 'string';
        })
        .map((block: { type: 'text'; text: string }) => block.text)
        .join('');
    }
  }

  return { text: text.trim(), sessionId };
}
