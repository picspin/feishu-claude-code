import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPetPreferences, savePetPreferences, updatePetPreferences } from './preferences.js';

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

test('loads defaults when preferences are missing', () => {
  const storage = new MemoryStorage();
  (globalThis as { localStorage?: Storage }).localStorage = storage as unknown as Storage;
  assert.deepEqual(loadPetPreferences(), {
    soundEnabled: true,
    musicEnabled: true,
    musicPlayOnWake: false,
  });
});

test('persists preference patches', () => {
  const storage = new MemoryStorage();
  (globalThis as { localStorage?: Storage }).localStorage = storage as unknown as Storage;
  const next = updatePetPreferences({ soundEnabled: false, musicPlayOnWake: true });
  assert.equal(next.soundEnabled, false);
  assert.equal(next.musicPlayOnWake, true);
  assert.equal(loadPetPreferences().soundEnabled, false);
  savePetPreferences({ soundEnabled: true, musicEnabled: false, musicPlayOnWake: false });
  assert.equal(loadPetPreferences().musicEnabled, false);
});

test('migrates legacy Spotify preference keys', () => {
  const storage = new MemoryStorage();
  (globalThis as { localStorage?: Storage }).localStorage = storage as unknown as Storage;
  storage.setItem(
    'dardanus-pet-preferences-v1',
    JSON.stringify({ soundEnabled: true, spotifyEnabled: false, spotifyPlayOnWake: true }),
  );
  const prefs = loadPetPreferences();
  assert.equal(prefs.musicEnabled, false);
  assert.equal(prefs.musicPlayOnWake, true);
});
