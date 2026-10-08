//! Tauri glue for the Ops Memory store: commands (root always comes from saved config, never from
//! the frontend) and the file watcher that reports external edits.

use crate::dock::AppState;
use crate::store::{self, FileInfo, HistoryEntry, WriteOutcome};
use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

fn root(state: &State<AppState>) -> Result<PathBuf, String> {
    let cfg = state.config.lock().map_err(|e| e.to_string())?;
    match (&cfg.ops_memory_path, cfg.setup_complete) {
        (Some(p), true) => Ok(PathBuf::from(p)),
        _ => Err("Ops Memory is not set up yet.".into()),
    }
}

#[tauri::command]
pub fn list_ops_files(state: State<AppState>) -> Result<Vec<FileInfo>, String> {
    store::list_files(&root(&state)?)
}

#[tauri::command]
pub fn read_ops_file(state: State<AppState>, path: String) -> Result<String, String> {
    store::read_file(&root(&state)?, &path)
}

/// Scan, write and commit a file. Returns `blocked` (with redacted findings) instead of writing when
/// the content looks like it holds secrets.
#[tauri::command]
pub fn write_ops_file(
    state: State<AppState>,
    path: String,
    content: String,
    message: String,
) -> Result<WriteOutcome, String> {
    let root = root(&state)?;
    // Record before writing so the watcher never reports our own change.
    if let Ok(full) = store::resolve_path(&root, &path) {
        if let (Ok(mut sw), Ok(canon_root)) = (state.self_writes.lock(), root.canonicalize()) {
            sw.record(full.clone());
            sw.record(canon_root.join(&path));
        }
    }
    store::write_file(&root, &path, &content, &message)
}

#[derive(serde::Deserialize)]
pub struct FileWrite {
    pub path: String,
    pub content: String,
}

/// Scan and write several files as one commit (all or nothing).
#[tauri::command]
pub fn write_ops_files(state: State<AppState>, files: Vec<FileWrite>, message: String) -> Result<WriteOutcome, String> {
    let root = root(&state)?;
    if let (Ok(mut sw), Ok(canon_root)) = (state.self_writes.lock(), root.canonicalize()) {
        for f in &files {
            sw.record(canon_root.join(&f.path));
        }
    }
    let pairs: Vec<(String, String)> = files.into_iter().map(|f| (f.path, f.content)).collect();
    store::write_files(&root, &pairs, &message)
}

#[tauri::command]
pub fn undo_last_change(state: State<AppState>) -> Result<String, String> {
    let root = root(&state)?;
    // A revert rewrites files; mark everything as ours for the window by listing current files.
    if let (Ok(files), Ok(mut sw)) = (store::list_files(&root), state.self_writes.lock()) {
        if let Ok(canon_root) = root.canonicalize() {
            for f in files {
                sw.record(canon_root.join(&f.path));
            }
        }
    }
    store::undo_last(&root)
}

#[tauri::command]
pub fn ops_history(state: State<AppState>, path: Option<String>, limit: usize) -> Result<Vec<HistoryEntry>, String> {
    store::history(&root(&state)?, path.as_deref(), limit)
}

/// (Re)start the watcher on the configured Ops Memory folder. Emits `ops://changed` with the list of
/// changed relative paths (debounced) for edits not made by Mochi.
pub fn restart_watcher(app: &AppHandle) {
    let state = app.state::<AppState>();
    let path = {
        let Ok(cfg) = state.config.lock() else { return };
        if !cfg.setup_complete {
            None
        } else {
            cfg.ops_memory_path.clone()
        }
    };
    let Ok(mut slot) = state.watcher.lock() else { return };
    *slot = None; // drops (stops) the previous watcher
    let Some(path) = path else { return };
    let Ok(root) = PathBuf::from(&path).canonicalize() else { return };

    let (tx, rx) = mpsc::channel::<Event>();
    let Ok(mut watcher) = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(ev) = res {
                let _ = tx.send(ev);
            }
        },
        Config::default(),
    ) else {
        return;
    };
    if watcher.watch(&root, RecursiveMode::Recursive).is_err() {
        return;
    }
    *slot = Some(watcher);

    let handle = app.clone();
    std::thread::spawn(move || {
        // Ends when the watcher (and its sender) is dropped.
        while let Ok(first) = rx.recv() {
            let mut events = vec![first];
            while let Ok(more) = rx.recv_timeout(Duration::from_millis(300)) {
                events.push(more);
            }
            let state = handle.state::<AppState>();
            let mut changed: Vec<String> = Vec::new();
            for ev in events {
                for p in ev.paths {
                    if !store::is_relevant_change(&root, &p) {
                        continue;
                    }
                    let own = state.self_writes.lock().map(|mut sw| sw.is_self_write(&p)).unwrap_or(false);
                    if own {
                        continue;
                    }
                    if let Ok(rel) = p.strip_prefix(&root) {
                        let rel = rel.to_string_lossy().replace('\\', "/");
                        if !changed.contains(&rel) {
                            changed.push(rel);
                        }
                    }
                }
            }
            if !changed.is_empty() {
                let _ = handle.emit("ops://changed", changed);
            }
        }
    });
}
