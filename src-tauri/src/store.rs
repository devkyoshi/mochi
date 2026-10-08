//! File store for Ops Memory: traversal-safe list/read/write, with every write going through
//! secret scan -> file write -> git commit, plus undo via `git revert`.

use crate::ops::{has_git_identity, run_git};
use crate::scanner::{self, Finding};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

const MAX_FILE_BYTES: usize = 1_000_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    /// Path relative to the root, forward slashes.
    pub path: String,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum WriteOutcome {
    /// Saved and committed (`commit` is the short hash).
    Saved { commit: String },
    /// Content identical to what is on disk; nothing committed.
    Unchanged,
    /// Refused because the content looks like it contains secrets. Nothing was written.
    Blocked { findings: Vec<Finding> },
}

/// Resolve a relative path inside `root`, rejecting anything that could escape it
/// (absolute paths, `..`, drive prefixes, `.git`, and symlinks pointing outside).
pub fn resolve_path(root: &Path, rel: &str) -> Result<PathBuf, String> {
    if rel.is_empty() || rel.contains('\0') {
        return Err("Invalid path.".into());
    }
    let rel_path = Path::new(rel);
    for c in rel_path.components() {
        match c {
            Component::Normal(name) => {
                if name.to_string_lossy().eq_ignore_ascii_case(".git") {
                    return Err("Access to .git is not allowed.".into());
                }
            }
            _ => return Err("Path must be relative and stay inside Ops Memory.".into()),
        }
    }
    let canon_root = root.canonicalize().map_err(|e| format!("Ops Memory folder is not available: {e}"))?;
    let joined = canon_root.join(rel_path);

    // Canonicalize the deepest existing ancestor to catch symlinks that leave the root.
    let mut probe = joined.as_path();
    loop {
        if probe.exists() {
            let real = probe.canonicalize().map_err(|e| e.to_string())?;
            if !real.starts_with(&canon_root) {
                return Err("Path escapes the Ops Memory folder.".into());
            }
            break;
        }
        match probe.parent() {
            Some(p) => probe = p,
            None => return Err("Invalid path.".into()),
        }
    }
    Ok(joined)
}

fn is_markdown(path: &Path) -> bool {
    path.extension().map(|e| e.eq_ignore_ascii_case("md")).unwrap_or(false)
}

/// List all markdown files under `root` (skipping `.git`), sorted by path.
pub fn list_files(root: &Path) -> Result<Vec<FileInfo>, String> {
    fn walk(base: &Path, dir: &Path, out: &mut Vec<FileInfo>) -> std::io::Result<()> {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name();
            if name.to_string_lossy().eq_ignore_ascii_case(".git") {
                continue;
            }
            let file_type = entry.file_type()?;
            if file_type.is_symlink() {
                continue; // never follow links out of the folder
            }
            if file_type.is_dir() {
                walk(base, &path, out)?;
            } else if is_markdown(&path) {
                let rel = path.strip_prefix(base).unwrap().to_string_lossy().replace('\\', "/");
                out.push(FileInfo { path: rel, size: entry.metadata()?.len() });
            }
        }
        Ok(())
    }
    let mut out = Vec::new();
    walk(root, root, &mut out).map_err(|e| e.to_string())?;
    out.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(out)
}

pub fn read_file(root: &Path, rel: &str) -> Result<String, String> {
    let path = resolve_path(root, rel)?;
    let meta = fs::metadata(&path).map_err(|_| "File not found.".to_string())?;
    if !meta.is_file() {
        return Err("Not a file.".into());
    }
    if meta.len() as usize > MAX_FILE_BYTES {
        return Err("File is too large.".into());
    }
    fs::read_to_string(&path).map_err(|e| format!("Could not read file: {e}"))
}

fn commit(root: &Path, args_after_commit: &[&str]) -> Result<String, String> {
    let mut args: Vec<&str> = Vec::new();
    if !has_git_identity(root) {
        args.extend(["-c", "user.name=Mochi", "-c", "user.email=mochi@localhost"]);
    }
    args.push("commit");
    args.extend_from_slice(args_after_commit);
    run_git(root, &args)
}

/// Scan, write and commit one file. `message` is used as the commit subject (prefixed with `mochi: `).
/// Only the written file is committed; other pending changes in the repo are left alone.
pub fn write_file(root: &Path, rel: &str, content: &str, message: &str) -> Result<WriteOutcome, String> {
    if content.len() > MAX_FILE_BYTES {
        return Err("Content is too large.".into());
    }
    let path = resolve_path(root, rel)?;
    if !is_markdown(&path) {
        return Err("Only .md files can be written.".into());
    }
    if path.is_dir() {
        return Err("That path is a folder.".into());
    }

    let findings = scanner::scan(content);
    if !findings.is_empty() {
        return Ok(WriteOutcome::Blocked { findings });
    }
    if fs::read_to_string(&path).map(|old| old == content).unwrap_or(false) {
        return Ok(WriteOutcome::Unchanged);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| format!("Could not write file: {e}"))?;

    let subject: String = message.lines().next().unwrap_or("update").chars().take(100).collect();
    let full = format!("mochi: {subject}");
    run_git(root, &["add", "--", rel])?;
    commit(root, &["-m", &full, "--only", "--", rel])?;
    let hash = run_git(root, &["rev-parse", "--short", "HEAD"])?;
    Ok(WriteOutcome::Saved { commit: hash })
}

/// Scan, write and commit several files as ONE commit. If any file contains secrets nothing is
/// written. `Unchanged` is returned when every file already has the given content.
pub fn write_files(root: &Path, files: &[(String, String)], message: &str) -> Result<WriteOutcome, String> {
    if files.is_empty() {
        return Err("No files to write.".into());
    }
    let mut seen = std::collections::HashSet::new();
    let mut resolved = Vec::new();
    for (rel, content) in files {
        if content.len() > MAX_FILE_BYTES {
            return Err("Content is too large.".into());
        }
        let path = resolve_path(root, rel)?;
        if !is_markdown(&path) {
            return Err("Only .md files can be written.".into());
        }
        if path.is_dir() {
            return Err("That path is a folder.".into());
        }
        if !seen.insert(rel.clone()) {
            return Err(format!("Duplicate path: {rel}"));
        }
        resolved.push(path);
    }

    let mut findings = Vec::new();
    for (rel, content) in files {
        for mut f in scanner::scan(content) {
            f.preview = format!("{rel}: {}", f.preview);
            findings.push(f);
        }
    }
    if !findings.is_empty() {
        return Ok(WriteOutcome::Blocked { findings });
    }

    let changed: Vec<usize> = (0..files.len())
        .filter(|&i| fs::read_to_string(&resolved[i]).map(|old| old != files[i].1).unwrap_or(true))
        .collect();
    if changed.is_empty() {
        return Ok(WriteOutcome::Unchanged);
    }

    // Remember originals so a failure part-way leaves the folder as it was.
    let originals: Vec<Option<String>> = changed.iter().map(|&i| fs::read_to_string(&resolved[i]).ok()).collect();
    for (k, &i) in changed.iter().enumerate() {
        let result = match resolved[i].parent() {
            Some(parent) => fs::create_dir_all(parent),
            None => Ok(()),
        }
        .and_then(|_| fs::write(&resolved[i], &files[i].1));
        if let Err(e) = result {
            for (j, &back) in changed.iter().enumerate().take(k + 1) {
                match &originals[j] {
                    Some(old) => {
                        let _ = fs::write(&resolved[back], old);
                    }
                    None => {
                        let _ = fs::remove_file(&resolved[back]);
                    }
                }
            }
            return Err(format!("Could not write file: {e}"));
        }
    }

    let subject: String = message.lines().next().unwrap_or("update").chars().take(100).collect();
    let full = format!("mochi: {subject}");
    let rels: Vec<&str> = changed.iter().map(|&i| files[i].0.as_str()).collect();
    let mut add_args = vec!["add", "--"];
    add_args.extend(rels.iter().copied());
    let mut commit_args = vec!["-m", full.as_str(), "--only", "--"];
    commit_args.extend(rels.iter().copied());
    run_git(root, &add_args)?;
    commit(root, &commit_args)?;
    let hash = run_git(root, &["rev-parse", "--short", "HEAD"])?;
    Ok(WriteOutcome::Saved { commit: hash })
}

/// Revert the most recent commit (new revert commit; history is kept). Refuses to revert the
/// initial commit. Returns the revert's short hash.
pub fn undo_last(root: &Path) -> Result<String, String> {
    let count: usize = run_git(root, &["rev-list", "--count", "HEAD"])?.parse().unwrap_or(0);
    if count <= 1 {
        return Err("Nothing to undo.".into());
    }
    if !run_git(root, &["status", "--porcelain"])?.is_empty() {
        return Err("There are uncommitted changes; save or discard them before undoing.".into());
    }
    let mut args: Vec<&str> = Vec::new();
    if !has_git_identity(root) {
        args.extend(["-c", "user.name=Mochi", "-c", "user.email=mochi@localhost"]);
    }
    args.extend(["revert", "--no-edit", "HEAD"]);
    if let Err(e) = run_git(root, &args) {
        let _ = run_git(root, &["revert", "--abort"]);
        return Err(e);
    }
    run_git(root, &["rev-parse", "--short", "HEAD"])
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub commit: String,
    pub subject: String,
    pub date: String,
}

/// Most recent commits (optionally for one file).
pub fn history(root: &Path, rel: Option<&str>, limit: usize) -> Result<Vec<HistoryEntry>, String> {
    let n = format!("-n{}", limit.clamp(1, 200));
    let mut args = vec!["log", &n, "--format=%h\u{1f}%s\u{1f}%cs"];
    if let Some(r) = rel {
        resolve_path(root, r)?;
        args.push("--");
        args.push(r);
    }
    let out = run_git(root, &args)?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let mut p = l.split('\u{1f}');
            Some(HistoryEntry { commit: p.next()?.into(), subject: p.next()?.into(), date: p.next()?.into() })
        })
        .collect())
}

// ------------------------------------------------------------------ watcher support

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Remembers paths Mochi just wrote so the file watcher does not report them as external changes.
#[derive(Default)]
pub struct SelfWrites {
    recent: HashMap<PathBuf, Instant>,
}

const SELF_WRITE_WINDOW: Duration = Duration::from_millis(1500);

impl SelfWrites {
    pub fn record(&mut self, path: PathBuf) {
        self.recent.insert(path, Instant::now());
    }

    /// True if `path` was written by Mochi within the window.
    pub fn is_self_write(&mut self, path: &Path) -> bool {
        self.recent.retain(|_, t| t.elapsed() < SELF_WRITE_WINDOW);
        self.recent.contains_key(path)
    }
}

/// Whether a changed path inside `root` is relevant to the UI (markdown, not inside `.git`).
pub fn is_relevant_change(root: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else { return false };
    if rel.components().any(|c| c.as_os_str().eq_ignore_ascii_case(".git")) {
        return false;
    }
    is_markdown(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ops::scaffold;

    fn repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        scaffold(dir.path(), "2026-10").unwrap();
        dir
    }

    fn commit_count(root: &Path) -> usize {
        run_git(root, &["rev-list", "--count", "HEAD"]).unwrap().parse().unwrap()
    }

    // ---- path safety

    #[test]
    fn resolve_rejects_traversal_absolute_and_odd_paths() {
        let dir = repo();
        for bad in ["../x.md", "vms/../../x.md", "..", "/etc/passwd", "", "vms/\0x.md", ".git/config", "vms/.GIT/x"] {
            assert!(resolve_path(dir.path(), bad).is_err(), "{bad:?} should be rejected");
        }
        if cfg!(windows) {
            for bad in ["C:\\Windows\\win.ini", "C:win.ini", "\\\\server\\share\\x.md", "\\x.md"] {
                assert!(resolve_path(dir.path(), bad).is_err(), "{bad:?} should be rejected");
            }
        }
    }

    #[test]
    fn resolve_accepts_normal_and_new_paths() {
        let dir = repo();
        assert!(resolve_path(dir.path(), "vms/new-vm.md").is_ok());
        assert!(resolve_path(dir.path(), "inbox.md").is_ok());
        assert!(resolve_path(dir.path(), "changelog/2030-01.md").is_ok());
    }

    #[test]
    fn resolve_rejects_symlinks_that_escape() {
        let dir = repo();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.md"), "x").unwrap();
        let link = dir.path().join("vms").join("link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        #[cfg(windows)]
        if std::os::windows::fs::symlink_dir(outside.path(), &link).is_err() {
            return; // symlink creation needs privileges on Windows; covered on Unix CI
        }
        assert!(resolve_path(dir.path(), "vms/link/secret.md").is_err());
        assert!(resolve_path(dir.path(), "vms/link/new.md").is_err());
        assert!(write_file(dir.path(), "vms/link/new.md", "hello", "x").is_err());
        assert!(!outside.path().join("new.md").exists());
        // and listing does not follow it
        assert!(list_files(dir.path()).unwrap().iter().all(|f| !f.path.contains("secret")));
    }

    #[test]
    fn read_and_write_reject_traversal() {
        let dir = repo();
        assert!(read_file(dir.path(), "../outside.md").is_err());
        assert!(write_file(dir.path(), "../outside.md", "x", "m").is_err());
        assert!(!dir.path().parent().unwrap().join("outside.md").exists());
    }

    // ---- listing / reading

    #[test]
    fn lists_markdown_files_sorted_and_skips_git_and_other_types() {
        let dir = repo();
        fs::write(dir.path().join("vms/b.md"), "b").unwrap();
        fs::write(dir.path().join("vms/a.md"), "a").unwrap();
        fs::write(dir.path().join("vms/notes.txt"), "t").unwrap();
        let paths: Vec<String> = list_files(dir.path()).unwrap().into_iter().map(|f| f.path).collect();
        assert_eq!(paths, vec!["INDEX.md", "changelog/2026-10.md", "inbox.md", "vms/a.md", "vms/b.md"]);
    }

    #[test]
    fn read_returns_content_and_errors_for_missing_or_directory() {
        let dir = repo();
        assert!(read_file(dir.path(), "inbox.md").unwrap().starts_with("# Inbox"));
        assert!(read_file(dir.path(), "nope.md").is_err());
        assert!(read_file(dir.path(), "vms").is_err());
    }

    // ---- write pipeline

    #[test]
    fn write_saves_commits_only_that_file_and_uses_prefixed_subject() {
        let dir = repo();
        let root = dir.path();
        let before = commit_count(root);
        fs::write(root.join("vms/other.md"), "pending, untracked").unwrap();

        let out = write_file(root, "vms/prod.md", "---\ntype: vm\nname: prod\n---\n", "update prod").unwrap();
        assert!(matches!(out, WriteOutcome::Saved { .. }));
        assert_eq!(commit_count(root), before + 1);
        assert_eq!(run_git(root, &["log", "-1", "--format=%s"]).unwrap(), "mochi: update prod");
        assert_eq!(run_git(root, &["show", "--name-only", "--format=", "HEAD"]).unwrap(), "vms/prod.md");
        assert_eq!(read_file(root, "vms/prod.md").unwrap(), "---\ntype: vm\nname: prod\n---\n");
    }

    #[test]
    fn write_blocks_secrets_and_writes_nothing() {
        let dir = repo();
        let root = dir.path();
        let before = commit_count(root);
        let out = write_file(root, "vms/prod.md", "DB_PASSWORD=SuperSecret123!\n", "add").unwrap();
        match out {
            WriteOutcome::Blocked { findings } => {
                assert_eq!(findings.len(), 1);
                assert!(!findings[0].preview.contains("SuperSecret123!"));
            }
            other => panic!("expected Blocked, got {other:?}"),
        }
        assert!(!root.join("vms/prod.md").exists());
        assert_eq!(commit_count(root), before);
    }

    #[test]
    fn write_blocks_secret_edits_to_existing_files_and_keeps_old_content() {
        let dir = repo();
        let root = dir.path();
        write_file(root, "vms/prod.md", "clean\n", "add").unwrap();
        let out = write_file(root, "vms/prod.md", "token: abcd1234efgh\n", "edit").unwrap();
        assert!(matches!(out, WriteOutcome::Blocked { .. }));
        assert_eq!(read_file(root, "vms/prod.md").unwrap(), "clean\n");
    }

    #[test]
    fn write_identical_content_is_unchanged_and_makes_no_commit() {
        let dir = repo();
        let root = dir.path();
        write_file(root, "vms/prod.md", "same\n", "add").unwrap();
        let n = commit_count(root);
        assert_eq!(write_file(root, "vms/prod.md", "same\n", "again").unwrap(), WriteOutcome::Unchanged);
        assert_eq!(commit_count(root), n);
    }

    #[test]
    fn write_rejects_non_markdown_directories_and_oversize() {
        let dir = repo();
        let root = dir.path();
        assert!(write_file(root, "vms/x.txt", "a", "m").is_err());
        assert!(write_file(root, "vms", "a", "m").is_err());
        assert!(write_file(root, "vms/big.md", &"a".repeat(MAX_FILE_BYTES + 1), "m").is_err());
    }

    #[test]
    fn commit_subject_is_single_line_and_truncated() {
        let dir = repo();
        let root = dir.path();
        write_file(root, "vms/a.md", "x\n", &format!("first line\nsecond line {}", "y".repeat(300))).unwrap();
        assert_eq!(run_git(root, &["log", "-1", "--format=%s"]).unwrap(), "mochi: first line");
    }

    #[test]
    fn write_creates_missing_subfolders() {
        let dir = repo();
        write_file(dir.path(), "changelog/2030-01.md", "# Changelog 2030-01\n", "new month").unwrap();
        assert!(dir.path().join("changelog/2030-01.md").exists());
    }

    // ---- batch write

    fn pair(p: &str, c: &str) -> (String, String) {
        (p.to_string(), c.to_string())
    }

    #[test]
    fn write_files_makes_one_commit_with_all_files() {
        let dir = repo();
        let root = dir.path();
        let before = commit_count(root);
        let files = vec![
            pair("vms/a.md", "a\n"),
            pair("changelog/2026-10.md", "# Changelog 2026-10\n\n- x\n"),
            pair("INDEX.md", "idx\n"),
        ];
        let out = write_files(root, &files, "quick add").unwrap();
        assert!(matches!(out, WriteOutcome::Saved { .. }));
        assert_eq!(commit_count(root), before + 1);
        let changed = run_git(root, &["show", "--name-only", "--format=", "HEAD"]).unwrap();
        for p in ["vms/a.md", "changelog/2026-10.md", "INDEX.md"] {
            assert!(changed.contains(p), "{p} not in commit: {changed}");
        }
        assert_eq!(read_file(root, "vms/a.md").unwrap(), "a\n");
    }

    #[test]
    fn write_files_blocks_everything_if_any_file_has_a_secret() {
        let dir = repo();
        let root = dir.path();
        let before = commit_count(root);
        let files = vec![pair("vms/ok.md", "fine\n"), pair("inbox.md", "password=hunter2\n")];
        match write_files(root, &files, "m").unwrap() {
            WriteOutcome::Blocked { findings } => {
                assert_eq!(findings.len(), 1);
                assert!(findings[0].preview.starts_with("inbox.md: "));
                assert!(!findings[0].preview.contains("hunter2"));
            }
            other => panic!("expected Blocked, got {other:?}"),
        }
        assert!(!root.join("vms/ok.md").exists());
        assert_eq!(commit_count(root), before);
    }

    #[test]
    fn write_files_validates_every_path_before_writing() {
        let dir = repo();
        let root = dir.path();
        let files = vec![pair("vms/ok.md", "x\n"), pair("../evil.md", "x\n")];
        assert!(write_files(root, &files, "m").is_err());
        assert!(!root.join("vms/ok.md").exists());
        assert!(write_files(root, &[pair("vms/a.txt", "x")], "m").is_err());
        assert!(write_files(root, &[], "m").is_err());
        let dup = vec![pair("vms/a.md", "1"), pair("vms/a.md", "2")];
        assert!(write_files(root, &dup, "m").unwrap_err().contains("Duplicate"));
    }

    #[test]
    fn write_files_skips_unchanged_files_and_reports_unchanged_when_nothing_differs() {
        let dir = repo();
        let root = dir.path();
        write_files(root, &[pair("vms/a.md", "1\n")], "add").unwrap();
        let n = commit_count(root);
        let out = write_files(root, &[pair("vms/a.md", "1\n")], "again").unwrap();
        assert_eq!(out, WriteOutcome::Unchanged);
        assert_eq!(commit_count(root), n);

        let mixed = vec![pair("vms/a.md", "1\n"), pair("vms/b.md", "2\n")];
        write_files(root, &mixed, "add b").unwrap();
        assert_eq!(run_git(root, &["show", "--name-only", "--format=", "HEAD"]).unwrap(), "vms/b.md");
    }

    #[test]
    fn write_files_commit_can_be_undone_as_a_unit() {
        let dir = repo();
        let root = dir.path();
        write_files(root, &[pair("vms/a.md", "a\n"), pair("vms/b.md", "b\n")], "two files").unwrap();
        undo_last(root).unwrap();
        assert!(!root.join("vms/a.md").exists() && !root.join("vms/b.md").exists());
    }

    // ---- undo / history

    #[test]
    fn undo_reverts_the_last_change_and_keeps_history() {
        let dir = repo();
        let root = dir.path();
        write_file(root, "vms/prod.md", "v1\n", "add").unwrap();
        write_file(root, "vms/prod.md", "v2\n", "edit").unwrap();
        let n = commit_count(root);

        undo_last(root).unwrap();
        assert_eq!(read_file(root, "vms/prod.md").unwrap(), "v1\n");
        assert_eq!(commit_count(root), n + 1);
        assert!(run_git(root, &["log", "-1", "--format=%s"]).unwrap().starts_with("Revert"));
    }

    #[test]
    fn undo_can_remove_a_newly_added_file() {
        let dir = repo();
        write_file(dir.path(), "vms/new.md", "x\n", "add").unwrap();
        undo_last(dir.path()).unwrap();
        assert!(!dir.path().join("vms/new.md").exists());
    }

    #[test]
    fn undo_refuses_initial_commit_and_dirty_tree() {
        let dir = repo();
        let root = dir.path();
        assert_eq!(undo_last(root).unwrap_err(), "Nothing to undo.");
        write_file(root, "vms/a.md", "x\n", "add").unwrap();
        fs::write(root.join("vms/dirty.md"), "uncommitted").unwrap();
        assert!(undo_last(root).unwrap_err().contains("uncommitted"));
        assert!(root.join("vms/a.md").exists());
    }

    #[test]
    fn history_lists_recent_commits_newest_first_optionally_per_file() {
        let dir = repo();
        let root = dir.path();
        write_file(root, "vms/a.md", "1\n", "add a").unwrap();
        write_file(root, "vms/b.md", "1\n", "add b").unwrap();
        let all = history(root, None, 10).unwrap();
        assert_eq!(all[0].subject, "mochi: add b");
        assert_eq!(all[1].subject, "mochi: add a");
        let only_a = history(root, Some("vms/a.md"), 10).unwrap();
        assert_eq!(only_a.len(), 1);
        assert_eq!(only_a[0].subject, "mochi: add a");
        assert!(history(root, Some("../x.md"), 10).is_err());
    }

    // ---- watcher helpers

    #[test]
    fn self_writes_are_remembered_briefly() {
        let mut sw = SelfWrites::default();
        let p = PathBuf::from("/root/vms/a.md");
        assert!(!sw.is_self_write(&p));
        sw.record(p.clone());
        assert!(sw.is_self_write(&p));
        assert!(!sw.is_self_write(Path::new("/root/vms/other.md")));
    }

    #[test]
    fn self_writes_expire() {
        let mut sw = SelfWrites::default();
        let p = PathBuf::from("/root/a.md");
        sw.recent.insert(p.clone(), Instant::now() - SELF_WRITE_WINDOW - Duration::from_millis(10));
        assert!(!sw.is_self_write(&p));
        assert!(sw.recent.is_empty());
    }

    #[test]
    fn only_markdown_outside_git_is_relevant() {
        let root = Path::new("/root");
        assert!(is_relevant_change(root, Path::new("/root/vms/a.md")));
        assert!(!is_relevant_change(root, Path::new("/root/.git/index")));
        assert!(!is_relevant_change(root, Path::new("/root/.git/COMMIT_EDITMSG.md")));
        assert!(!is_relevant_change(root, Path::new("/root/vms/a.txt")));
        assert!(!is_relevant_change(root, Path::new("/elsewhere/a.md")));
    }
}
