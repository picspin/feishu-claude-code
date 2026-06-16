#[tauri::command]
pub fn ensure_daemon() -> Result<String, String> {
    crate::daemon::ensure_daemon()
}

#[tauri::command]
pub fn start_daemon() -> Result<String, String> {
    crate::daemon::start_daemon()
}

#[tauri::command]
pub fn stop_daemon() -> Result<String, String> {
    crate::daemon::stop_daemon()
}

#[tauri::command]
pub fn daemon_status() -> Result<String, String> {
    crate::daemon::daemon_status()
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn position_near_dock(window: tauri::WebviewWindow) -> Result<(), String> {
    crate::window::position_near_dock(window)
}
