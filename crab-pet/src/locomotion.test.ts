import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextCrawlStep } from './locomotion.js';

test('moves crawl window in one direction at sixteen pixels per second', () => {
  assert.deepEqual(
    nextCrawlStep({
      position: { x: 100, y: 714 },
      direction: 1,
      elapsedMs: 1_000,
      speedPxPerSec: 16,
      windowSize: { width: 180, height: 150 },
      workArea: { x: 0, y: 50, width: 1_440, height: 875 },
    }),
    { position: { x: 116, y: 714 }, direction: 1 },
  );
});

test('reverses crawl direction only at the screen edge', () => {
  assert.deepEqual(
    nextCrawlStep({
      position: { x: 1_250, y: 714 },
      direction: 1,
      elapsedMs: 1_000,
      speedPxPerSec: 16,
      windowSize: { width: 180, height: 150 },
      workArea: { x: 0, y: 50, width: 1_440, height: 875 },
    }),
    { position: { x: 1_260, y: 714 }, direction: -1 },
  );

  assert.deepEqual(
    nextCrawlStep({
      position: { x: 2, y: 714 },
      direction: -1,
      elapsedMs: 1_000,
      speedPxPerSec: 16,
      windowSize: { width: 180, height: 150 },
      workArea: { x: 0, y: 50, width: 1_440, height: 875 },
    }),
    { position: { x: 0, y: 714 }, direction: 1 },
  );
});
