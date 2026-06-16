import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGestureTracker } from './gestures.js';

test('maps a single click to bubbling recent activity', () => {
  const gestures = createGestureTracker();
  assert.equal(gestures.click(1_000), 'bubbling');
});

test('maps a fast double click to temporary crawl', () => {
  const gestures = createGestureTracker();
  gestures.click(1_000);
  assert.equal(gestures.click(1_240), 'crawl');
});

test('maps more than three clicks in a burst to shrink', () => {
  const gestures = createGestureTracker();
  gestures.click(1_000);
  gestures.click(1_160);
  gestures.click(1_320);
  assert.equal(gestures.click(1_480), 'shrink');
});

test('resets click burst after the burst window expires', () => {
  const gestures = createGestureTracker({ burstWindowMs: 700 });
  gestures.click(1_000);
  gestures.click(1_160);
  gestures.click(1_320);
  assert.equal(gestures.click(2_100), 'bubbling');
});
