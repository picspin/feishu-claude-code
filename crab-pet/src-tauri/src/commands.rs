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

#[tauri::command]
pub fn open_setup_guide(url: String) -> Result<(), String> {
    crate::setup::open_setup_guide(&url)
}

#[tauri::command]
pub fn save_setup_config(
    config: std::collections::HashMap<String, String>,
) -> Result<String, String> {
    crate::setup::save_setup_config(config)
}
