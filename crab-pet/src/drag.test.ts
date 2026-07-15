import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampPetDrag, shouldContinueDrag, snapPetToMagneticTargets } from './drag.js';

test('keeps pet drag clamped inside the full work area without magnetic snapping while moving', () => {
  assert.deepEqual(
    clampPetDrag({
      startWindow: { x: 20, y: 714 },
      pointerDelta: { x: -5, y: 0 },
      scaleFactor: 1,
      windowSize: { width: 360, height: 300 },
      workArea: { x: 0, y: 50, width: 2880, height: 1750 },
    }),
    { x: 15, y: 714 },
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
      threshold: 6,
    }),
    { x: 12, y: 336 },
  );

  assert.deepEqual(
    snapPetToMagneticTargets({
      position: { x: 2518, y: 1472 },
      windowSize,
      workArea,
      threshold: 6,
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

test('snaps pet to a single foreground window target on release', () => {
  const workArea = { x: 0, y: 50, width: 2880, height: 1750 };
  const windowSize = { width: 160, height: 124 };

  assert.deepEqual(
    snapPetToMagneticTargets({
      position: { x: 632, y: 404 },
      windowSize,
      workArea,
      magnetRects: [{ x: 800, y: 400, width: 900, height: 700 }],
      threshold: 8,
    }),
    { x: 632, y: 400 },
  );

  assert.deepEqual(
    snapPetToMagneticTargets({
      position: { x: 632, y: 391 },
      windowSize,
      workArea,
      magnetRects: [{ x: 800, y: 400, width: 900, height: 700 }],
      threshold: 8,
    }),
    { x: 632, y: 391 },
  );
});

test('continues dragging only while the primary pointer button is pressed', () => {
  assert.equal(shouldContinueDrag(1), true);
  assert.equal(shouldContinueDrag(0), false);
  assert.equal(shouldContinueDrag(2), false);
});
