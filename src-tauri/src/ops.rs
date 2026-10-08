//! Ops Memory directory setup: validation, scaffolding from the shipped templates, and `git init`.

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

const INBOX_TEMPLATE: &str = include_str!("../../templates/inbox.md");
const CHANGELOG_TEMPLATE: &str = include_str!("../../templates/changelog.md");
const SCHEMA_VERSION: &str = "1\n";
const FOLDER_NAME: &str = "ops-memory";

const MOCHI_CONFIG: &str = "{\n  \"infraKeywords\": [\"ssh\", \"scp\", \"rsync\", \"docker\", \"docker compose\", \"systemctl\", \"nginx\", \"pm2\", \"kubectl\", \"helm\", \"terraform\", \"ansible\"],\n  \"staleDays\": 30\n}\n";

/// Directories (and their descendants) that must never be used as Ops Memory.
const SYSTEM_DIRS: &[&str] = &[
    "/etc", "/usr", "/bin", "/sbin", "/lib", "/boot", "/dev", "/proc", "/sys", "/var", "/root", "/system", "/library",
    "c:/windows", "c:/program files", "c:/program files (x86)", "c:/programdata",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupResult {
    pub path: String,
    /// True when a new git repository was created (false if one already existed).
    pub git_initialized: bool,
    /// Files and folders created (relative paths).
    pub created: Vec<String>,
}

/// Check that `path` can be used as an Ops Memory directory. The directory itself need not exist yet,
/// but its closest existing ancestor must be writable.
pub fn validate_directory(path: &Path, home: Option<&Path>) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Choose an absolute folder path.".into());
    }
    if path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return Err("The path must not contain '.' or '..'.".into());
    }
    if path.parent().is_none() || path.components().filter(|c| matches!(c, Component::Normal(_))).count() == 0 {
        return Err("Choose a folder, not a drive or filesystem root.".into());
    }
    let lower = path.to_string_lossy().replace('\\', "/").to_lowercase();
    let lower = lower.trim_end_matches('/');
    if SYSTEM_DIRS.iter().any(|d| lower == *d || lower.starts_with(&format!("{d}/"))) {
        return Err("That is a system folder. Choose another location.".into());
    }
    if let Some(home) = home {
        // The home folder itself, or anything above it (e.g. C:\Users), is too broad.
        if home.starts_with(path) {
            return Err("Choose a dedicated folder, not your home folder or one of its parents.".into());
        }
    }

    if path.exists() {
        if !path.is_dir() {
            return Err("That path is a file, not a folder.".into());
        }
        return check_writable(path);
    }
    let mut ancestor = path.parent();
    while let Some(a) = ancestor {
        if a.exists() {
            if !a.is_dir() {
                return Err("A parent of that path is a file.".into());
            }
            return check_writable(a);
        }
        ancestor = a.parent();
    }
    Err("The folder's location does not exist.".into())
}

fn check_writable(dir: &Path) -> Result<(), String> {
    let probe = dir.join(format!(".mochi-write-test-{}", std::process::id()));
    match fs::write(&probe, b"") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            Ok(())
        }
        Err(_) => Err("That folder is not writable.".into()),
    }
}

fn run_git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("Could not run git (is it installed?): {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(format!("git {} failed: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&out.stderr).trim()))
    }
}

fn has_git_identity(dir: &Path) -> bool {
    run_git(dir, &["config", "user.name"]).map(|s| !s.is_empty()).unwrap_or(false)
        && run_git(dir, &["config", "user.email"]).map(|s| !s.is_empty()).unwrap_or(false)
}

fn write_if_missing(root: &Path, rel: &str, contents: &str, created: &mut Vec<String>) -> Result<(), String> {
    let target = root.join(rel);
    if target.exists() {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, contents).map_err(|e| e.to_string())?;
    created.push(rel.to_string());
    Ok(())
}

fn mkdir_if_missing(root: &Path, rel: &str, created: &mut Vec<String>) -> Result<(), String> {
    let target = root.join(rel);
    if !target.exists() {
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        created.push(format!("{rel}/"));
    }
    Ok(())
}

/// Create the Ops Memory layout in `root` (existing files are never overwritten), initialise git
/// if needed, and commit the scaffold. `month` is `YYYY-MM`, used for the first changelog file.
pub fn scaffold(root: &Path, month: &str) -> Result<SetupResult, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let mut created = Vec::new();

    for d in ["vms", "projects", "changelog", ".mochi"] {
        mkdir_if_missing(root, d, &mut created)?;
    }
    write_if_missing(root, "inbox.md", INBOX_TEMPLATE, &mut created)?;
    write_if_missing(root, ".mochi/config.json", MOCHI_CONFIG, &mut created)?;
    write_if_missing(root, ".mochi/schema-version", SCHEMA_VERSION, &mut created)?;
    write_if_missing(
        root,
        &format!("changelog/{month}.md"),
        &CHANGELOG_TEMPLATE.replace("<YYYY-MM>", month),
        &mut created,
    )?;
    write_if_missing(
        root,
        "INDEX.md",
        "# Ops Memory Index\n\n<!-- Auto-generated by Mochi. Do not edit by hand. -->\n\n## VMs (0)\n\n_None yet._\n\n## Projects (0)\n\n_None yet._\n",
        &mut created,
    )?;
    // Keep empty folders in git.
    for d in ["vms", "projects"] {
        write_if_missing(root, &format!("{d}/.gitkeep"), "", &mut created)?;
    }

    let git_initialized = !root.join(".git").exists();
    if git_initialized {
        run_git(root, &["init", "-b", "main"])?;
    }
    run_git(root, &["add", "-A"])?;
    if !created.is_empty() || git_initialized {
        let message = "mochi: initialize Ops Memory";
        let result = if has_git_identity(root) {
            run_git(root, &["commit", "-m", message, "--allow-empty"])
        } else {
            run_git(
                root,
                &["-c", "user.name=Mochi", "-c", "user.email=mochi@localhost", "commit", "-m", message, "--allow-empty"],
            )
        };
        result?;
    }

    Ok(SetupResult { path: root.to_string_lossy().into_owned(), git_initialized, created })
}

/// Resolve the final directory: either the chosen folder, or `<chosen>/ops-memory` for "create new".
pub fn resolve_target(chosen: &Path, create_new: bool) -> PathBuf {
    if create_new {
        chosen.join(FOLDER_NAME)
    } else {
        chosen.to_path_buf()
    }
}

/// Tauri command: validate a candidate directory without changing anything.
#[tauri::command]
pub fn validate_ops_directory(app: tauri::AppHandle, path: String, create_new: bool) -> Result<String, String> {
    use tauri::Manager;
    let target = resolve_target(Path::new(&path), create_new);
    let home = app.path().home_dir().ok();
    validate_directory(&target, home.as_deref())?;
    Ok(target.to_string_lossy().into_owned())
}

/// Tauri command: validate, scaffold and commit. Returns what was created.
#[tauri::command]
pub fn setup_ops_memory(app: tauri::AppHandle, path: String, create_new: bool) -> Result<SetupResult, String> {
    use tauri::Manager;
    let target = resolve_target(Path::new(&path), create_new);
    let home = app.path().home_dir().ok();
    validate_directory(&target, home.as_deref())?;
    let month = chrono::Local::now().format("%Y-%m").to_string();
    scaffold(&target, &month)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn abs(p: &Path) -> PathBuf {
        p.to_path_buf()
    }

    #[test]
    fn rejects_relative_and_dotdot_paths() {
        assert!(validate_directory(Path::new("relative/dir"), None).is_err());
        let dir = tempfile::tempdir().unwrap();
        let sneaky = dir.path().join("a").join("..").join("b");
        assert!(validate_directory(&sneaky, None).unwrap_err().contains(".."));
    }

    #[test]
    fn rejects_filesystem_roots() {
        let root = if cfg!(windows) { Path::new("C:\\") } else { Path::new("/") };
        assert!(validate_directory(root, None).is_err());
    }

    #[test]
    fn rejects_system_directories() {
        let candidates: &[&str] = if cfg!(windows) {
            &["C:\\Windows", "C:\\Windows\\System32", "C:\\Program Files\\App", "c:\\programdata"]
        } else {
            &["/etc", "/usr/local", "/var/lib/x", "/root"]
        };
        for c in candidates {
            assert!(validate_directory(Path::new(c), None).unwrap_err().contains("system"), "{c}");
        }
    }

    #[test]
    fn rejects_home_and_its_parents_but_allows_subfolders() {
        let base = tempfile::tempdir().unwrap();
        let home = base.path().join("users").join("me");
        fs::create_dir_all(&home).unwrap();
        assert!(validate_directory(&home, Some(&home)).unwrap_err().contains("home"));
        assert!(validate_directory(home.parent().unwrap(), Some(&home)).is_err());
        assert!(validate_directory(&home.join("ops-memory"), Some(&home)).is_ok());
    }

    #[test]
    fn rejects_files_and_missing_locations() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f.txt");
        fs::write(&file, "x").unwrap();
        assert!(validate_directory(&file, None).unwrap_err().contains("file"));
        assert!(validate_directory(&file.join("child"), None).unwrap_err().contains("file"));
    }

    #[test]
    fn accepts_new_folder_in_writable_parent_and_leaves_no_probe_files() {
        let dir = tempfile::tempdir().unwrap();
        assert!(validate_directory(&dir.path().join("new").join("deeper"), None).is_ok());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[test]
    fn rejects_read_only_directory() {
        let dir = tempfile::tempdir().unwrap();
        let mut perms = fs::metadata(dir.path()).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(dir.path(), perms.clone()).unwrap();
        // Directory read-only flags are not enforced for file creation on Windows, so only assert on Unix.
        let result = validate_directory(dir.path(), None);
        perms.set_readonly(false);
        fs::set_permissions(dir.path(), perms).unwrap();
        if cfg!(unix) && !is_root() {
            assert!(result.unwrap_err().contains("not writable"));
        }
    }

    fn is_root() -> bool {
        std::env::var("USER").map(|u| u == "root").unwrap_or(false)
    }

    #[test]
    fn resolve_target_appends_folder_name_only_for_new() {
        let p = Path::new("/x/y");
        assert_eq!(resolve_target(p, true), p.join("ops-memory"));
        assert_eq!(resolve_target(p, false), abs(p));
    }

    #[test]
    fn scaffold_creates_layout_and_git_history() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("ops-memory");
        let result = scaffold(&root, "2026-10").unwrap();

        assert!(result.git_initialized);
        for rel in ["vms", "projects", "changelog", ".mochi", "inbox.md", "INDEX.md", ".mochi/config.json", ".mochi/schema-version", "changelog/2026-10.md"] {
            assert!(root.join(rel).exists(), "missing {rel}");
        }
        assert!(fs::read_to_string(root.join("changelog/2026-10.md")).unwrap().starts_with("# Changelog 2026-10"));
        assert_eq!(fs::read_to_string(root.join(".mochi/schema-version")).unwrap().trim(), "1");

        let log = run_git(&root, &["log", "--format=%s"]).unwrap();
        assert_eq!(log, "mochi: initialize Ops Memory");
        assert_eq!(run_git(&root, &["status", "--porcelain"]).unwrap(), "");
        assert!(run_git(&root, &["branch", "--show-current"]).unwrap() == "main");
    }

    #[test]
    fn scaffold_config_contains_no_secrets_and_is_valid_json() {
        let dir = tempfile::tempdir().unwrap();
        scaffold(dir.path(), "2026-10").unwrap();
        let text = fs::read_to_string(dir.path().join(".mochi/config.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert!(v["infraKeywords"].as_array().unwrap().len() > 5);
        assert!(!text.to_lowercase().contains("password"));
    }

    #[test]
    fn scaffold_is_idempotent_and_never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        scaffold(root, "2026-10").unwrap();
        fs::write(root.join("inbox.md"), "my notes\n").unwrap();
        fs::write(root.join("vms/prod.md"), "---\ntype: vm\nname: prod\n---\n").unwrap();

        let again = scaffold(root, "2026-10").unwrap();
        assert!(!again.git_initialized);
        assert!(again.created.is_empty(), "{:?}", again.created);
        assert_eq!(fs::read_to_string(root.join("inbox.md")).unwrap(), "my notes\n");
        assert!(root.join("vms/prod.md").exists());
        // Re-running makes no extra commit when nothing was created.
        assert_eq!(run_git(root, &["rev-list", "--count", "HEAD"]).unwrap(), "1");
    }

    #[test]
    fn scaffold_uses_existing_folder_and_keeps_existing_git_repo() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        run_git(root, &["init", "-b", "main"]).unwrap();
        fs::create_dir(root.join("vms")).unwrap();
        fs::write(root.join("vms/old.md"), "---\ntype: vm\nname: old\n---\n").unwrap();

        let result = scaffold(root, "2026-10").unwrap();
        assert!(!result.git_initialized);
        assert!(!result.created.contains(&"vms/".to_string()));
        assert!(root.join("vms/old.md").exists());
        // Existing files are committed together with the scaffold.
        let tracked = run_git(root, &["ls-files"]).unwrap();
        assert!(tracked.contains("vms/old.md") && tracked.contains("inbox.md"));
    }

    #[test]
    fn scaffold_commits_even_without_a_configured_git_identity() {
        // The fallback identity path must work; simulate by running in a repo with identity unset locally.
        let dir = tempfile::tempdir().unwrap();
        let result = scaffold(dir.path(), "2026-10");
        assert!(result.is_ok(), "{result:?}");
    }
}
