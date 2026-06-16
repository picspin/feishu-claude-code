type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

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
