import assert from 'node:assert/strict';
import { test } from 'node:test';
import { soundCueForState } from './sounds.js';

test('maps pet states to sound cues', () => {
  assert.equal(soundCueForState('sleep'), 'sleep');
  assert.equal(soundCueForState('idle-shrink'), 'sleep');
  assert.equal(soundCueForState('wave-claw'), 'wave-claw');
  assert.equal(soundCueForState('crawl'), 'crawl');
  assert.equal(soundCueForState('bubbling'), 'bubbling');
  assert.equal(soundCueForState('wink'), 'wink');
  assert.equal(soundCueForState('shrink'), 'shrink');
  assert.equal(soundCueForState('dodge'), 'dodge');
  assert.equal(soundCueForState('awake'), 'awake');
});
