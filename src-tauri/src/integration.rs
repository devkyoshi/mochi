//! Tauri commands for the Claude Code integration (global rule + hooks). They operate on the real
//! `~/.claude` folder, but only when the user explicitly asks for it in the UI; the logic itself lives in
//! `install.rs` and is tested against temp folders.

use crate::dock::AppState;
use crate::install::{self, InstallPlan, IntegrationStatus};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};

fn hook_file_name() -> &'static str {
    if cfg!(windows) {
        "mochi-hook.exe"
    } else {
        "mochi-hook"
    }
}

/// Where the installed hook helper lives: `<app config dir>/hooks/mochi-hook[.exe]`.
fn installed_hook_path(state: &State<AppState>) -> PathBuf {
    state.config_dir.join("hooks").join(hook_file_name())
}

fn claude_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| format!("Could not find your home folder: {e}"))?;
    Ok(install::claude_dir_of(&home))
}

/// The Ops Memory path to put into the rule: the explicit one (wizard) or the saved one.
fn ops_path(state: &State<AppState>, explicit: Option<String>) -> Result<String, String> {
    let path = match explicit {
        Some(p) => p,
        None => state
            .config
            .lock()
            .map_err(|e| e.to_string())?
            .ops_memory_path
            .clone()
            .ok_or("Ops Memory is not set up yet.")?,
    };
    if !Path::new(&path).is_absolute() || !Path::new(&path).is_dir() {
        return Err("The Ops Memory folder does not exist.".into());
    }
    Ok(path)
}

/// A real executable is far larger than the placeholder `build.rs` creates for fresh checkouts.
const MIN_BINARY_BYTES: u64 = 10_000;

/// True when `path` looks like a real hook helper rather than a build placeholder.
pub fn looks_like_real_binary(path: &Path) -> bool {
    fs::metadata(path).map(|m| m.is_file() && m.len() >= MIN_BINARY_BYTES).unwrap_or(false)
}

/// Dry run: what installing (or uninstalling) would change. Writes nothing.
#[tauri::command]
pub fn integration_preview(
    app: AppHandle,
    state: State<AppState>,
    uninstall: bool,
    ops_path_override: Option<String>,
) -> Result<InstallPlan, String> {
    let dir = claude_dir(&app)?;
    if uninstall {
        install::plan_uninstall(&dir)
    } else {
        let ops = ops_path(&state, ops_path_override)?;
        install::plan_install(&dir, &ops, &installed_hook_path(&state))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallResult {
    pub backups: Vec<String>,
    pub status: IntegrationStatus,
}

fn stamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

/// Copy the hook helper next to the app into the stable hooks folder, back up the Claude config files,
/// and apply the plan.
#[tauri::command]
pub fn integration_install(
    app: AppHandle,
    state: State<AppState>,
    ops_path_override: Option<String>,
) -> Result<InstallResult, String> {
    let dir = claude_dir(&app)?;
    let ops = ops_path(&state, ops_path_override)?;
    let target = installed_hook_path(&state);

    let source = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .map(|p| p.join(hook_file_name()))
        .ok_or("Could not locate the app folder.")?;
    if !looks_like_real_binary(&source) {
        return Err(format!(
            "The hook helper ({}) was not found next to the app. Build it with `cargo build --bin mochi-hook`.",
            hook_file_name()
        ));
    }
    fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::copy(&source, &target).map_err(|e| format!("Could not install the hook helper: {e}"))?;

    let plan = install::plan_install(&dir, &ops, &target)?;
    let backups = install::apply(&plan, &stamp())?;
    Ok(InstallResult { backups, status: install::status(&dir) })
}

/// Remove Mochi's block and hook entries (backing the files up first) and delete the hook helper.
#[tauri::command]
pub fn integration_uninstall(app: AppHandle, state: State<AppState>) -> Result<InstallResult, String> {
    let dir = claude_dir(&app)?;
    let plan = install::plan_uninstall(&dir)?;
    let backups = install::apply(&plan, &stamp())?;
    let _ = fs::remove_file(installed_hook_path(&state));
    Ok(InstallResult { backups, status: install::status(&dir) })
}

#[tauri::command]
pub fn integration_status(app: AppHandle) -> Result<IntegrationStatus, String> {
    Ok(install::status(&claude_dir(&app)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholders_and_missing_files_are_not_accepted_as_the_hook_helper() {
        let dir = tempfile::tempdir().unwrap();
        let placeholder = dir.path().join("mochi-hook");
        fs::write(&placeholder, "MOCHI-HOOK-PLACEHOLDER: run `npm run prepare:hook`
").unwrap();
        assert!(!looks_like_real_binary(&placeholder));
        assert!(!looks_like_real_binary(&dir.path().join("missing")));
        assert!(!looks_like_real_binary(dir.path()));
        let big = dir.path().join("big");
        fs::write(&big, vec![0u8; 20_000]).unwrap();
        assert!(looks_like_real_binary(&big));
    }

    #[test]
    fn hook_file_name_matches_the_platform() {
        assert_eq!(hook_file_name().ends_with(".exe"), cfg!(windows));
        assert!(hook_file_name().starts_with("mochi-hook"));
    }
}
