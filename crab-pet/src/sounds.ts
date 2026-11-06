import type { CrabState } from './state.js';

export type PetSoundCue = 'sleep' | 'wave-claw' | 'crawl' | 'bubbling' | 'wink' | 'shrink' | 'awake' | 'dodge';

export interface PetSoundBoard {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  unlock(): void;
  onState(state: CrabState): void;
  play(cue: PetSoundCue): void;
  stop(): void;
}

type StopHandle = () => void;

/**
 * Procedural Web Audio SFX for Dardanus states.
 * Keeps the bundle free of binary audio assets and works offline.
 */
export function createPetSoundBoard(options: { enabled?: boolean } = {}): PetSoundBoard {
  let enabled = options.enabled ?? true;
  let context: AudioContext | null = null;
  let lastState: CrabState | undefined;
  let loopStops: StopHandle[] = [];
  let masterGain: GainNode | null = null;

  function getContext(): AudioContext | null {
    if (typeof window === 'undefined') {
      return null;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      return null;
    }
    if (!context) {
      context = new AudioCtx();
      masterGain = context.createGain();
      masterGain.gain.value = 0.22;
      masterGain.connect(context.destination);
    }
    return context;
  }

  function unlock(): void {
    const ctx = getContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
  }

  function stopLoops(): void {
    for (const stop of loopStops) {
      stop();
    }
    loopStops = [];
  }

  function tone(
    ctx: AudioContext,
    destination: AudioNode,
    params: {
      frequency: number;
      duration: number;
      type?: OscillatorType;
      attack?: number;
      decay?: number;
      peak?: number;
      startAt?: number;
      detune?: number;
    },
  ): void {
    const startAt = params.startAt ?? ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = params.type ?? 'sine';
    osc.frequency.value = params.frequency;
    if (params.detune !== undefined) {
      osc.detune.value = params.detune;
    }
    const peak = params.peak ?? 0.8;
    const attack = params.attack ?? 0.01;
    const decay = params.decay ?? params.duration;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), startAt + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + Math.max(attack + 0.01, decay));
    osc.connect(gain);
    gain.connect(destination);
    osc.start(startAt);
    osc.stop(startAt + params.duration + 0.05);
  }

  function noiseBurst(
    ctx: AudioContext,
    destination: AudioNode,
    params: { duration: number; peak?: number; startAt?: number; highpass?: number },
  ): void {
    const startAt = params.startAt ?? ctx.currentTime;
    const length = Math.max(1, Math.floor(ctx.sampleRate * params.duration));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = params.highpass ?? 800;
    const gain = ctx.createGain();
    const peak = params.peak ?? 0.35;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + params.duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(startAt);
    source.stop(startAt + params.duration + 0.02);
  }

  function playCue(cue: PetSoundCue): void {
    if (!enabled) {
      return;
    }
    const ctx = getContext();
    if (!ctx || !masterGain) {
      return;
    }
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    switch (cue) {
      case 'sleep':
        // Soft Zzz pulse: two low sines.
        tone(ctx, masterGain, { frequency: 180, duration: 0.55, type: 'sine', peak: 0.35, decay: 0.55 });
        tone(ctx, masterGain, { frequency: 240, duration: 0.45, type: 'triangle', peak: 0.18, startAt: ctx.currentTime + 0.12, decay: 0.45 });
        break;
      case 'wave-claw':
        // Bright chirp + light metallic tap.
        tone(ctx, masterGain, { frequency: 780, duration: 0.12, type: 'square', peak: 0.28, decay: 0.12 });
        tone(ctx, masterGain, { frequency: 1180, duration: 0.18, type: 'triangle', peak: 0.22, startAt: ctx.currentTime + 0.05, decay: 0.18 });
        noiseBurst(ctx, masterGain, { duration: 0.05, peak: 0.18, highpass: 1600 });
        break;
      case 'crawl':
        // Scuttle tick.
        noiseBurst(ctx, masterGain, { duration: 0.04, peak: 0.22, highpass: 1200 });
        tone(ctx, masterGain, { frequency: 420, duration: 0.06, type: 'square', peak: 0.12, decay: 0.06 });
        break;
      case 'bubbling':
        // Bubble pops at staggered pitches.
        tone(ctx, masterGain, { frequency: 640, duration: 0.12, type: 'sine', peak: 0.28, decay: 0.12 });
        tone(ctx, masterGain, { frequency: 820, duration: 0.1, type: 'sine', peak: 0.2, startAt: ctx.currentTime + 0.08, decay: 0.1 });
        tone(ctx, masterGain, { frequency: 980, duration: 0.1, type: 'sine', peak: 0.16, startAt: ctx.currentTime + 0.16, decay: 0.1 });
        break;
      case 'wink':
        tone(ctx, masterGain, { frequency: 920, duration: 0.08, type: 'triangle', peak: 0.2, decay: 0.08 });
        break;
      case 'shrink':
        tone(ctx, masterGain, { frequency: 260, duration: 0.18, type: 'sawtooth', peak: 0.18, decay: 0.18 });
        tone(ctx, masterGain, { frequency: 140, duration: 0.22, type: 'sine', peak: 0.25, startAt: ctx.currentTime + 0.04, decay: 0.22 });
        break;
      case 'dodge':
        noiseBurst(ctx, masterGain, { duration: 0.05, peak: 0.2, highpass: 900 });
        tone(ctx, masterGain, { frequency: 520, duration: 0.08, type: 'square', peak: 0.14, decay: 0.08 });
        break;
      case 'awake':
        tone(ctx, masterGain, { frequency: 520, duration: 0.1, type: 'sine', peak: 0.18, decay: 0.1 });
        tone(ctx, masterGain, { frequency: 760, duration: 0.12, type: 'triangle', peak: 0.14, startAt: ctx.currentTime + 0.06, decay: 0.12 });
        break;
      default:
        break;
    }
  }

  function startLoop(cue: 'sleep' | 'crawl' | 'bubbling', intervalMs: number): void {
    playCue(cue);
    const timer = window.setInterval(() => {
      playCue(cue);
    }, intervalMs);
    loopStops.push(() => window.clearInterval(timer));
  }

  function onState(state: CrabState): void {
    if (state === lastState) {
      return;
    }
    const previous = lastState;
    lastState = state;
    stopLoops();
    if (!enabled) {
      return;
    }

    // Avoid spammy awake chirp when leaving short interactions back to idle.
    if (state === 'awake' && previous && previous !== 'sleep' && previous !== 'idle-shrink') {
      return;
    }

    const cue = soundCueForState(state);
    if (!cue) {
      return;
    }

    if (cue === 'crawl') {
      startLoop('crawl', 280);
      return;
    }
    if (cue === 'sleep') {
      startLoop('sleep', 2_600);
      return;
    }
    if (cue === 'bubbling') {
      startLoop('bubbling', 900);
      return;
    }
    playCue(cue);
  }

  return {
    setEnabled(next) {
      enabled = next;
      if (!enabled) {
        stopLoops();
      }
    },
    isEnabled() {
      return enabled;
    },
    unlock,
    onState,
    play(cue) {
      playCue(cue);
    },
    stop() {
      stopLoops();
    },
  };
}

export function soundCueForState(state: CrabState): PetSoundCue | null {
  switch (state) {
    case 'sleep':
    case 'idle-shrink':
      return 'sleep';
    case 'wave-claw':
      return 'wave-claw';
    case 'crawl':
      return 'crawl';
    case 'bubbling':
      return 'bubbling';
    case 'wink':
      return 'wink';
    case 'shrink':
      return 'shrink';
    case 'dodge':
      return 'dodge';
    case 'awake':
      return 'awake';
    default:
      return null;
  }
}
