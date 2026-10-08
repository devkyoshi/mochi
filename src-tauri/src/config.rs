//! App configuration persisted in the OS app-config directory. Never holds secrets.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_HOTKEY: &str = "CommandOrControl+Shift+Space";
const FILE_NAME: &str = "config.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppConfig {
    /// Global shortcut that shows/hides the dock.
    pub hotkey: String,
    /// Collapse the dock when it loses focus.
    pub auto_collapse: bool,
    /// Name of the monitor the dock was last shown on.
    pub monitor: Option<String>,
    /// Mascot sounds on/off.
    pub sound: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self { hotkey: DEFAULT_HOTKEY.to_string(), auto_collapse: true, monitor: None, sound: true }
    }
}

fn config_path(dir: &Path) -> PathBuf {
    dir.join(FILE_NAME)
}

/// Load the config from `dir`. A missing, unreadable or corrupt file yields the defaults;
/// unknown or missing fields are tolerated.
pub fn load(dir: &Path) -> AppConfig {
    fs::read_to_string(config_path(dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Save the config to `dir`, creating it if needed. Writes atomically via a temp file.
pub fn save(dir: &Path, config: &AppConfig) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{FILE_NAME}.tmp"));
    fs::write(&tmp, serde_json::to_string_pretty(config)?)?;
    fs::rename(&tmp, config_path(dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_when_file_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()), AppConfig::default());
    }

    #[test]
    fn save_then_load_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = AppConfig {
            hotkey: "Alt+M".into(),
            auto_collapse: false,
            monitor: Some("DISPLAY2".into()),
            sound: false,
        };
        save(dir.path(), &cfg).unwrap();
        assert_eq!(load(dir.path()), cfg);
    }

    #[test]
    fn save_creates_missing_directories_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("a").join("b");
        save(&nested, &AppConfig::default()).unwrap();
        assert!(nested.join("config.json").exists());
        assert!(!nested.join("config.json.tmp").exists());
    }

    #[test]
    fn corrupt_file_falls_back_to_defaults() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("config.json"), "{ not json").unwrap();
        assert_eq!(load(dir.path()), AppConfig::default());
    }

    #[test]
    fn partial_file_fills_in_defaults() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("config.json"), r#"{"autoCollapse": false, "future": 1}"#).unwrap();
        let cfg = load(dir.path());
        assert!(!cfg.auto_collapse);
        assert_eq!(cfg.hotkey, DEFAULT_HOTKEY);
    }

    #[test]
    fn serializes_with_camel_case_keys() {
        let json = serde_json::to_string(&AppConfig::default()).unwrap();
        assert!(json.contains("autoCollapse"));
        assert!(!json.contains("auto_collapse"));
    }
}
