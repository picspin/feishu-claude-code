import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampPetDrag, shouldContinueDrag, snapPetToMagneticTargets } from './drag.js';

test('keeps pet drag clamped inside the full work area', () => {
  assert.deepEqual(
    clampPetDrag({
      startWindow: { x: 630, y: 714 },
      pointerDelta: { x: 80, y: -40 },
      scaleFactor: 2,
      windowSize: { width: 360, height: 300 },
      workArea: { x: 0, y: 50, width: 2880, height: 1750 },
    }),
    { x: 790, y: 634 },
  );

  assert.deepEqual(
    clampPetDrag({
      startWindow: { x: 630, y: 714 },
      pointerDelta: { x: -500, y: 900 },
      scaleFactor: 2,
      windowSize: { width: 360, height: 300 },
      workArea: { x: 0, y: 50, width: 2880, height: 1750 },
    }),
    { x: 0, y: 1500 },
  );
});

test('snaps pet near screen edges and the Dock band', () => {
  const workArea = { x: 0, y: 50, width: 2880, height: 1750 };
  const windowSize = { width: 360, height: 300 };

  assert.deepEqual(
    snapPetToMagneticTargets({
      position: { x: 12, y: 336 },
      windowSize,
      workArea,
      threshold: 28,
    }),
    { x: 0, y: 336 },
  );

  assert.deepEqual(
    snapPetToMagneticTargets({
      position: { x: 2518, y: 1472 },
      windowSize,
      workArea,
      threshold: 28,
    }),
    { x: 2520, y: 1468 },
  );

  assert.deepEqual(
    snapPetToMagneticTargets({
      position: { x: 500, y: 620 },
      windowSize,
      workArea,
      threshold: 28,
    }),
    { x: 500, y: 620 },
  );
});

test('continues dragging only while the primary pointer button is pressed', () => {
  assert.equal(shouldContinueDrag(1), true);
  assert.equal(shouldContinueDrag(0), false);
  assert.equal(shouldContinueDrag(2), false);
});
