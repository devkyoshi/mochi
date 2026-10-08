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
    /// Chosen Ops Memory directory (set by the setup wizard).
    pub ops_memory_path: Option<String>,
    /// True once the setup wizard has finished.
    pub setup_complete: bool,
    /// How Mochi talks to Claude: "cli" or "api" (None = not connected). The API key itself lives in the OS keychain.
    pub claude_provider: Option<String>,
    /// Apply Claude's proposed edits without asking for approval.
    pub auto_apply: bool,
    /// A VM/project not updated for this many days is flagged as stale.
    pub stale_days: u32,
    /// The mascot falls asleep after this many idle minutes.
    pub sleepy_minutes: u32,
    /// Start Mochi when the user logs in (mirrors the OS autostart entry).
    pub launch_at_login: bool,
}

pub const MIN_STALE_DAYS: u32 = 1;
pub const MAX_STALE_DAYS: u32 = 365;
pub const MIN_SLEEPY_MINUTES: u32 = 1;
pub const MAX_SLEEPY_MINUTES: u32 = 240;

impl AppConfig {
    /// Clamp numeric settings into their valid ranges.
    pub fn sanitized(mut self) -> Self {
        self.stale_days = self.stale_days.clamp(MIN_STALE_DAYS, MAX_STALE_DAYS);
        self.sleepy_minutes = self.sleepy_minutes.clamp(MIN_SLEEPY_MINUTES, MAX_SLEEPY_MINUTES);
        if !matches!(self.claude_provider.as_deref(), None | Some("cli") | Some("api")) {
            self.claude_provider = None;
        }
        self
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self { hotkey: DEFAULT_HOTKEY.to_string(), auto_collapse: true, monitor: None, sound: true, ops_memory_path: None, setup_complete: false, claude_provider: None, auto_apply: false, stale_days: 30, sleepy_minutes: 10, launch_at_login: false }
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
            ops_memory_path: Some("D:/ops".into()),
            setup_complete: true,
            claude_provider: Some("api".into()),
            auto_apply: true,
            stale_days: 14,
            sleepy_minutes: 5,
            launch_at_login: true,
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
        assert!(json.contains("opsMemoryPath") && json.contains("setupComplete"));
        assert!(json.contains("claudeProvider") && json.contains("autoApply"));
        assert!(json.contains("staleDays") && json.contains("sleepyMinutes") && json.contains("launchAtLogin"));
        assert!(!json.contains("auto_collapse"));
    }

    #[test]
    fn defaults_for_new_settings() {
        let c = AppConfig::default();
        assert_eq!((c.stale_days, c.sleepy_minutes, c.launch_at_login), (30, 10, false));
    }

    #[test]
    fn sanitized_clamps_out_of_range_values_and_keeps_valid_ones() {
        let c = AppConfig { stale_days: 0, sleepy_minutes: 100_000, ..AppConfig::default() }.sanitized();
        assert_eq!((c.stale_days, c.sleepy_minutes), (MIN_STALE_DAYS, MAX_SLEEPY_MINUTES));
        let c = AppConfig { stale_days: 10_000, sleepy_minutes: 0, ..AppConfig::default() }.sanitized();
        assert_eq!((c.stale_days, c.sleepy_minutes), (MAX_STALE_DAYS, MIN_SLEEPY_MINUTES));
        let ok = AppConfig { stale_days: 45, sleepy_minutes: 20, ..AppConfig::default() };
        assert_eq!(ok.clone().sanitized(), ok);
    }

    #[test]
    fn sanitized_drops_unknown_claude_providers() {
        for ok in [None, Some("cli"), Some("api")] {
            let c = AppConfig { claude_provider: ok.map(String::from), ..AppConfig::default() }.sanitized();
            assert_eq!(c.claude_provider.as_deref(), ok);
        }
        let bad = AppConfig { claude_provider: Some("rm -rf".into()), ..AppConfig::default() }.sanitized();
        assert_eq!(bad.claude_provider, None);
    }

    #[test]
    fn old_config_files_without_the_new_fields_still_load() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("config.json"), r#"{"hotkey":"Alt+M","setupComplete":true}"#).unwrap();
        let c = load(dir.path());
        assert_eq!((c.stale_days, c.sleepy_minutes), (30, 10));
        assert!(c.setup_complete);
    }
}
