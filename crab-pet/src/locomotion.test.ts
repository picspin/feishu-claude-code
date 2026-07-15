import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextCrawlStep } from './locomotion.js';

test('moves crawl window left at sixteen pixels per second', () => {
  assert.deepEqual(
    nextCrawlStep({
      position: { x: 100, y: 714 },
      direction: -1,
      elapsedMs: 1_000,
      speedPxPerSec: 16,
      windowSize: { width: 160, height: 124 },
      workArea: { x: 0, y: 50, width: 1_440, height: 875 },
    }),
    { position: { x: 84, y: 714 }, direction: -1 },
  );
});

test('wraps from the left edge to the right edge without turning around', () => {
  assert.deepEqual(
    nextCrawlStep({
      position: { x: 16, y: 714 },
      direction: 1,
      elapsedMs: 1_000,
      speedPxPerSec: 16,
      windowSize: { width: 160, height: 124 },
      workArea: { x: 0, y: 50, width: 1_728, height: 875 },
    }),
    { position: { x: 1_552, y: 714 }, direction: -1 },
  );
});
