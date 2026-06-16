mod commands;
mod daemon;
mod window;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = crate::window::position_near_dock(window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ensure_daemon,
            commands::start_daemon,
            commands::stop_daemon,
            commands::daemon_status,
            commands::quit_app,
            commands::position_near_dock
        ])
        .build(tauri::generate_context!())
        .expect("error while building Tauri app")
        .run(|_app_handle, event| {
            if should_stop_daemon_for_event(&event) {
                let _ = crate::daemon::stop_daemon();
            }
        });
}

fn should_stop_daemon_for_event(event: &tauri::RunEvent) -> bool {
    matches!(
        event,
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
    )
}

#[cfg(test)]
mod tests {
    use super::should_stop_daemon_for_event;

    #[test]
    fn stops_daemon_on_final_exit_event() {
        assert!(should_stop_daemon_for_event(&tauri::RunEvent::Exit));
    }
}
