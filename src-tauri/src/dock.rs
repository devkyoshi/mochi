//! Dock window behaviour: placement, global hotkey, persisted settings.

use crate::config::{self, AppConfig};
use crate::geometry::{choose_monitor, dock_rect, MonitorInfo, COLLAPSED_SIZE, EXPANDED_SIZE};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub const MAIN_WINDOW: &str = "main";

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub config_dir: PathBuf,
    /// Paths Mochi just wrote (so the watcher ignores them).
    pub self_writes: Mutex<crate::store::SelfWrites>,
    /// Active file watcher on the Ops Memory folder (dropping it stops watching).
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

fn to_info(m: &tauri::Monitor) -> MonitorInfo {
    MonitorInfo {
        name: m.name().cloned(),
        x: m.position().x,
        y: m.position().y,
        width: m.size().width,
        height: m.size().height,
        scale: m.scale_factor(),
    }
}

/// Size and position the main window as the collapsed pill or expanded panel on the right monitor.
pub fn place_dock(app: &AppHandle, expanded: bool, follow_cursor: bool) -> Result<(), String> {
    let win = app.get_webview_window(MAIN_WINDOW).ok_or("main window not found")?;
    let state = app.state::<AppState>();

    let monitors = win.available_monitors().map_err(|e| e.to_string())?;
    let infos: Vec<MonitorInfo> = monitors.iter().map(to_info).collect();
    let cursor = if follow_cursor { app.cursor_position().ok().map(|p| (p.x, p.y)) } else { None };
    let saved = state.config.lock().map_err(|e| e.to_string())?.monitor.clone();
    let idx = choose_monitor(&infos, cursor, saved.as_deref()).ok_or("no monitors available")?;

    let size = if expanded { EXPANDED_SIZE } else { COLLAPSED_SIZE };
    let rect = dock_rect(&infos[idx], size, 0.0);
    win.set_size(PhysicalSize::new(rect.width, rect.height)).map_err(|e| e.to_string())?;
    win.set_position(PhysicalPosition::new(rect.x, rect.y)).map_err(|e| e.to_string())?;

    // Remember which screen the dock lives on.
    if infos[idx].name != saved {
        let mut cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.monitor = infos[idx].name.clone();
        let _ = config::save(&state.config_dir, &cfg);
    }
    Ok(())
}

/// (Re)register the global toggle hotkey. Emits `dock://toggle` when pressed.
pub fn register_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    hotkey.parse::<Shortcut>().map_err(|e| format!("Invalid hotkey '{hotkey}': {e}"))?;
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    gs.on_shortcut(hotkey, |app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            let _ = app.emit("dock://toggle", ());
        }
    })
    .map_err(|e| format!("Could not register '{hotkey}': {e}"))
}

#[tauri::command]
pub fn get_config(state: State<AppState>) -> Result<AppConfig, String> {
    Ok(state.config.lock().map_err(|e| e.to_string())?.clone())
}

/// Replace the settings. If the hotkey changed it is re-registered first; on failure the old
/// hotkey is restored and an error is returned.
#[tauri::command]
pub fn set_config(app: AppHandle, state: State<AppState>, config: AppConfig) -> Result<AppConfig, String> {
    let old = state.config.lock().map_err(|e| e.to_string())?.clone();
    if config.hotkey != old.hotkey {
        if let Err(e) = register_hotkey(&app, &config.hotkey) {
            let _ = register_hotkey(&app, &old.hotkey);
            return Err(e);
        }
    }
    config::save(&state.config_dir, &config).map_err(|e| e.to_string())?;
    *state.config.lock().map_err(|e| e.to_string())? = config.clone();
    if config.ops_memory_path != old.ops_memory_path || config.setup_complete != old.setup_complete {
        crate::opsfs::restart_watcher(&app);
    }
    Ok(config)
}

/// Expand or collapse the dock window. `follow_cursor` moves it to the monitor under the cursor
/// (used when summoned by the hotkey).
#[tauri::command]
pub fn set_dock_state(app: AppHandle, expanded: bool, follow_cursor: bool) -> Result<(), String> {
    place_dock(&app, expanded, follow_cursor)?;
    let win = app.get_webview_window(MAIN_WINDOW).ok_or("main window not found")?;
    win.show().map_err(|e| e.to_string())?;
    if expanded {
        let _ = win.set_always_on_top(true);
        let _ = win.set_focus();
    }
    Ok(())
}
