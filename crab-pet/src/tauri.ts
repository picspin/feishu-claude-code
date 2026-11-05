type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MusicStatus {
  installed: boolean;
  running: boolean;
  playing: boolean;
  track?: string | null;
  artist?: string | null;
  message: string;
}

interface TauriGlobal {
  core?: {
    invoke?: Invoke;
  };
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = (window as Window & { __TAURI__?: TauriGlobal }).__TAURI__;
  const invokeFn = tauri?.core?.invoke;
  if (!invokeFn) {
    return Promise.reject(new Error('Tauri invoke is unavailable outside the desktop app'));
  }
  return invokeFn<T>(command, args);
}

export async function startDaemon(): Promise<string> {
  return invoke<string>('start_daemon');
}

export async function ensureDaemon(): Promise<string> {
  return invoke<string>('ensure_daemon');
}

export async function stopDaemon(): Promise<string> {
  return invoke<string>('stop_daemon');
}

export async function quitApp(): Promise<void> {
  await invoke<void>('quit_app');
}

export async function positionNearDock(): Promise<void> {
  await invoke<void>('position_near_dock');
}

export async function openSetupGuide(url: string): Promise<void> {
  await invoke<void>('open_setup_guide', { url });
}

export async function saveSetupConfig(config: Record<string, string>): Promise<string> {
  return invoke<string>('save_setup_config', { config });
}

export async function frontmostWindowBounds(): Promise<WindowBounds | null> {
  return invoke<WindowBounds | null>('frontmost_window_bounds');
}

export async function musicStatus(): Promise<MusicStatus> {
  return invoke<MusicStatus>('music_status');
}

export async function musicPlayPause(): Promise<MusicStatus> {
  return invoke<MusicStatus>('music_playpause');
}

export async function musicPlay(): Promise<MusicStatus> {
  return invoke<MusicStatus>('music_play');
}

export async function musicNext(): Promise<MusicStatus> {
  return invoke<MusicStatus>('music_next');
}
