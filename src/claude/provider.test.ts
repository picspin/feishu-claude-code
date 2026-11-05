import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Query } from '@anthropic-ai/claude-agent-sdk';
import { claudeQuery } from './provider.js';

function fakeQuery(messages: unknown[], failure?: Error): Query {
  return (async function* () {
    for (const message of messages) {
      yield message;
    }
    if (failure) {
      throw failure;
    }
  })() as Query;
}

test('restarts a resumed session after a context overflow', async () => {
  const calls: Array<{ prompt: string; resume?: string }> = [];
  const queryFactory = ((input: { prompt: string; options: { resume?: string } }) => {
    calls.push({ prompt: input.prompt, resume: input.options.resume });
    if (calls.length === 1) {
      return fakeQuery([
        {
          type: 'assistant',
          error: 'invalid_request',
          isApiErrorMessage: true,
          message: { content: [{ type: 'text', text: 'Prompt is too long' }] },
        },
      ], new Error('Claude Code process exited with code 1'));
    }
    return fakeQuery([
      { type: 'system', session_id: 'fresh-session' },
      { type: 'assistant', message: { content: [{ type: 'text', text: '已恢复并继续。' }] } },
    ]);
  }) as typeof import('@anthropic-ai/claude-agent-sdk').query;

  const result = await claudeQuery({
    prompt: '继续执行任务',
    cwd: '/tmp',
    resume: 'oversized-session',
    recoveryContext: '最近进度：已完成检索，下一步下载 PDF。',
  }, queryFactory);

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.resume, 'oversized-session');
  assert.equal(calls[1]?.resume, undefined);
  assert.match(calls[1]?.prompt || '', /最近进度/);
  assert.equal(result.sessionId, 'fresh-session');
  assert.equal(result.text, '已恢复并继续。');
  assert.equal(result.recoveredFromContextOverflow, true);
});

test('does not retry an unrelated Claude process failure', async () => {
  let calls = 0;
  const queryFactory = (() => {
    calls += 1;
    return fakeQuery([], new Error('Claude Code process exited with code 1'));
  }) as typeof import('@anthropic-ai/claude-agent-sdk').query;

  await assert.rejects(
    claudeQuery({ prompt: 'hello', cwd: '/tmp', resume: 'session' }, queryFactory),
    /Claude Code process exited with code 1/,
  );
  assert.equal(calls, 1);
});
