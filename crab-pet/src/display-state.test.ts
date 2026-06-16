import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTimedPetDisplay } from './display-state.js';

test('keeps online idle pet awake before the first wave interval', () => {
  const display = createTimedPetDisplay();
  assert.equal(display.update('awake', 0), 'awake');
  assert.equal(display.update('awake', 59_999), 'awake');
});

test('waves once per minute for five seconds while awake', () => {
  const display = createTimedPetDisplay();
  display.update('awake', 0);
  assert.equal(display.update('awake', 60_000), 'wave-claw');
  assert.equal(display.update('awake', 64_999), 'wave-claw');
  assert.equal(display.update('awake', 65_000), 'awake');
});

test('uses idle shrink after five minutes awake without replacing sleep', () => {
  const display = createTimedPetDisplay();
  display.update('awake', 0);
  assert.equal(display.update('awake', 299_999), 'awake');
  assert.equal(display.update('awake', 300_000), 'idle-shrink');
  assert.equal(display.update('sleep', 301_000), 'sleep');
});

test('resets awake timer after non-awake business states', () => {
  const display = createTimedPetDisplay();
  display.update('awake', 0);
  display.update('crawl', 30_000);
  assert.equal(display.update('awake', 40_000), 'awake');
  assert.equal(display.update('awake', 99_999), 'awake');
  assert.equal(display.update('awake', 100_000), 'wave-claw');
});
