mod config;
mod dock;
mod geometry;
mod ops;
mod scanner;

use dock::AppState;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Returns the application version (placeholder command used to verify the IPC bridge).
#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = window.emit("dock://blur", ());
            }
        })
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let cfg = config::load(&config_dir);
            let hotkey = cfg.hotkey.clone();
            app.manage(AppState { config: Mutex::new(cfg), config_dir });

            if let Err(e) = dock::register_hotkey(app.handle(), &hotkey) {
                eprintln!("hotkey: {e}");
            }
            if let Err(e) = dock::place_dock(app.handle(), false, false) {
                eprintln!("placement: {e}");
            }
            if let Some(win) = app.get_webview_window(dock::MAIN_WINDOW) {
                let _ = win.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_version,
            scanner::scan_secrets,
            dock::get_config,
            dock::set_config,
            dock::set_dock_state,
            ops::validate_ops_directory,
            ops::setup_ops_memory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_version_matches_cargo_package() {
        assert_eq!(app_version(), env!("CARGO_PKG_VERSION"));
        assert!(!app_version().is_empty());
    }
}
