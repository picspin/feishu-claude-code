import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interactionDurationMs } from './animation.js';

test('keeps click-triggered crawl visible for five seconds', () => {
  assert.equal(interactionDurationMs('crawl'), 5_000);
});

test('keeps click-triggered shrink visible for ten seconds', () => {
  assert.equal(interactionDurationMs('shrink'), 10_000);
});

test('keeps bubbling visible for five seconds', () => {
  assert.equal(interactionDurationMs('bubbling'), 5_000);
});
