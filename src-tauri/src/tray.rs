//! System tray icon with Open / Show-hide / Quit, and the launch-at-login commands.

use crate::dock::MAIN_WINDOW;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

#[derive(Debug, PartialEq, Eq)]
pub enum TrayAction {
    Open,
    ToggleVisibility,
    Quit,
    Ignore,
}

/// Map a tray menu item id to its action.
pub fn tray_action(id: &str) -> TrayAction {
    match id {
        "open" => TrayAction::Open,
        "visibility" => TrayAction::ToggleVisibility,
        "quit" => TrayAction::Quit,
        _ => TrayAction::Ignore,
    }
}

fn perform(app: &AppHandle, action: TrayAction) {
    match action {
        TrayAction::Open => {
            if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
                let _ = win.show();
            }
            let _ = app.emit("dock://toggle", ());
        }
        TrayAction::ToggleVisibility => {
            if let Some(win) = app.get_webview_window(MAIN_WINDOW) {
                if win.is_visible().unwrap_or(false) {
                    let _ = win.hide();
                } else {
                    let _ = win.show();
                }
            }
        }
        TrayAction::Quit => app.exit(0),
        TrayAction::Ignore => {}
    }
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Mochi", true, None::<&str>)?;
    let visibility = MenuItem::with_id(app, "visibility", "Show / hide dock", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Mochi", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &visibility, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .tooltip("Mochi")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| perform(app, tray_action(event.id.as_ref())))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                perform(tray.app_handle(), TrayAction::Open);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Enable or disable starting Mochi at login (only ever called from an explicit user action).
#[tauri::command]
pub fn set_launch_at_login(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| format!("Could not enable launch at login: {e}"))
    } else {
        manager.disable().map_err(|e| format!("Could not disable launch at login: {e}"))
    }
}

#[tauri::command]
pub fn get_launch_at_login(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_ids_map_to_actions() {
        assert_eq!(tray_action("open"), TrayAction::Open);
        assert_eq!(tray_action("visibility"), TrayAction::ToggleVisibility);
        assert_eq!(tray_action("quit"), TrayAction::Quit);
        assert_eq!(tray_action(""), TrayAction::Ignore);
        assert_eq!(tray_action("something-else"), TrayAction::Ignore);
    }
}
