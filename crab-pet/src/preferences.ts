export interface PetPreferences {
  soundEnabled: boolean;
  musicEnabled: boolean;
  /** When true, waking the bridge also sends play to Music.app. */
  musicPlayOnWake: boolean;
}

const STORAGE_KEY = 'dardanus-pet-preferences-v1';

const DEFAULTS: PetPreferences = {
  soundEnabled: true,
  musicEnabled: true,
  musicPlayOnWake: false,
};

interface StoredPreferences extends Partial<PetPreferences> {
  /** Legacy Spotify keys — still read for one-time migration. */
  spotifyEnabled?: boolean;
  spotifyPlayOnWake?: boolean;
}

export function loadPetPreferences(): PetPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULTS };
    }
    const parsed = JSON.parse(raw) as StoredPreferences;
    return {
      soundEnabled: parsed.soundEnabled ?? DEFAULTS.soundEnabled,
      musicEnabled: parsed.musicEnabled ?? parsed.spotifyEnabled ?? DEFAULTS.musicEnabled,
      musicPlayOnWake: parsed.musicPlayOnWake ?? parsed.spotifyPlayOnWake ?? DEFAULTS.musicPlayOnWake,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePetPreferences(next: PetPreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function updatePetPreferences(patch: Partial<PetPreferences>): PetPreferences {
  const next = { ...loadPetPreferences(), ...patch };
  savePetPreferences(next);
  return next;
}
