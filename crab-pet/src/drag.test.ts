import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampHorizontalDockDrag, shouldContinueHorizontalDrag } from './drag.js';

test('keeps dock pet drag horizontal and clamped inside work area', () => {
  assert.deepEqual(
    clampHorizontalDockDrag({
      startWindow: { x: 630, y: 714 },
      pointerDeltaX: 80,
      scaleFactor: 2,
      windowSize: { width: 360, height: 300 },
      workArea: { x: 0, y: 50, width: 2880, height: 1750 },
    }),
    { x: 790, y: 714 },
  );

  assert.deepEqual(
    clampHorizontalDockDrag({
      startWindow: { x: 630, y: 714 },
      pointerDeltaX: -500,
      scaleFactor: 2,
      windowSize: { width: 360, height: 300 },
      workArea: { x: 0, y: 50, width: 2880, height: 1750 },
    }),
    { x: 0, y: 714 },
  );
});

test('continues dragging only while the primary pointer button is pressed', () => {
  assert.equal(shouldContinueHorizontalDrag(1), true);
  assert.equal(shouldContinueHorizontalDrag(0), false);
  assert.equal(shouldContinueHorizontalDrag(2), false);
});
