//! Logic behind the `mochi-hook` binary used by Claude Code's Stop and SessionEnd hooks.
//!
//! Detection is cheap pattern matching over the session transcript (no LLM). It never reads or logs
//! secret values: results only contain matched keyword names and counts. Everything fails open: any
//! problem means "allow" (exit 0, no output).

use regex::Regex;
use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_KEYWORDS: usize = 100;
const MAX_KEYWORD_LEN: usize = 40;
const MARKER_MAX_AGE_SECS: u64 = 7 * 24 * 3600;

pub fn default_keywords() -> Vec<String> {
    [
        "ssh", "scp", "rsync", "docker", "docker compose", "docker-compose", "systemctl", "nginx", "pm2", "kubectl",
        "helm", "terraform", "ansible", "deploy.sh",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// Input JSON that Claude Code sends to the hook on stdin (only the fields we use).
#[derive(Debug, Default, Deserialize)]
pub struct HookInput {
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub transcript_path: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub stop_hook_active: bool,
}

pub fn parse_input(text: &str) -> Option<HookInput> {
    serde_json::from_str(text).ok()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    /// Only tool calls after the latest real user prompt.
    LastTurn,
    /// The whole transcript.
    Session,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Analysis {
    /// Sorted, unique keyword names that matched (never command text).
    pub infra: Vec<String>,
    /// A file inside Ops Memory was written during the scope.
    pub ops_modified: bool,
    /// Number of real user prompts in the whole transcript (identifies the turn).
    pub prompts: usize,
}

fn normalize_path(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}

fn is_under(root: &str, path: &str) -> bool {
    let (root, path) = (normalize_path(root), normalize_path(path));
    !root.is_empty() && (path == root || path.starts_with(&format!("{root}/")))
}

fn keyword_regexes(keywords: &[String]) -> Vec<(String, Regex)> {
    keywords
        .iter()
        .filter(|k| !k.trim().is_empty() && k.len() <= MAX_KEYWORD_LEN)
        .take(MAX_KEYWORDS)
        .filter_map(|k| {
            let body = k.trim().split_whitespace().map(regex::escape).collect::<Vec<_>>().join(r"\s+");
            Regex::new(&format!(r"(?i)(^|[^A-Za-z0-9_.-]){body}($|[^A-Za-z0-9_.-]|\.($|\s))")).ok().map(|r| (k.trim().to_string(), r))
        })
        .collect()
}

/// Walk a JSON value and collect every tool call (`{ "name": ..., "input": {...} }`).
fn collect_tool_calls<'a>(v: &'a Value, out: &mut Vec<(&'a str, &'a Value)>) {
    match v {
        Value::Object(map) => {
            if let (Some(Value::String(name)), Some(input @ Value::Object(_))) = (map.get("name"), map.get("input")) {
                out.push((name.as_str(), input));
            }
            for child in map.values() {
                collect_tool_calls(child, out);
            }
        }
        Value::Array(items) => items.iter().for_each(|i| collect_tool_calls(i, out)),
        _ => {}
    }
}

/// A user entry that is a real prompt (not a tool result being fed back).
fn is_user_prompt(v: &Value) -> bool {
    if v["type"] != "user" {
        return false;
    }
    let content = if v["message"]["content"].is_null() { &v["content"] } else { &v["message"]["content"] };
    match content {
        Value::String(s) => !s.trim().is_empty(),
        Value::Array(blocks) => !blocks.iter().any(|b| b["type"] == "tool_result") && !blocks.is_empty(),
        _ => false,
    }
}

fn writes_to_etc(cmd: &str) -> bool {
    static_regex(r"(>\s*/etc/|\btee\b[^|;&]*\s/etc/|\bsed\s+-i[^|;&]*/etc/|\b(cp|mv|install)\b[^|;&]*\s/etc/)").is_match(cmd)
}

fn static_regex(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid regex")
}

fn command_touches_ops(cmd: &str, ops_root: &str) -> bool {
    let c = cmd.replace('\\', "/").to_lowercase();
    let r = normalize_path(ops_root);
    if r.is_empty() || !c.contains(&r) {
        return false;
    }
    static_regex(r"(>|\btee\b|\bsed\s+-i|\bmv\b|\bcp\b|\bgit\s+(add|commit)\b|\bset-content\b|\badd-content\b|\bout-file\b)").is_match(&c)
}

/// Analyze a JSONL transcript.
pub fn analyze(transcript: &str, ops_root: &str, keywords: &[String], scope: Scope) -> Analysis {
    let regexes = keyword_regexes(keywords);
    let mut prompts = 0usize;
    // Tool calls, tagged with the number of prompts seen before them.
    let mut calls: Vec<(usize, String, Value)> = Vec::new();

    for line in transcript.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if is_user_prompt(&v) {
            prompts += 1;
            continue;
        }
        let mut found = Vec::new();
        collect_tool_calls(&v, &mut found);
        for (name, input) in found {
            calls.push((prompts, name.to_string(), input.clone()));
        }
    }

    let mut infra: Vec<String> = Vec::new();
    let mut ops_modified = false;
    for (turn, name, input) in &calls {
        if scope == Scope::LastTurn && *turn != prompts {
            continue;
        }
        match name.as_str() {
            "Bash" | "PowerShell" => {
                let cmd = input["command"].as_str().unwrap_or("");
                for (kw, re) in &regexes {
                    if re.is_match(cmd) && !infra.contains(kw) {
                        infra.push(kw.clone());
                    }
                }
                if writes_to_etc(cmd) && !infra.iter().any(|k| k == "etc-write") {
                    infra.push("etc-write".into());
                }
                if command_touches_ops(cmd, ops_root) {
                    ops_modified = true;
                }
            }
            "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => {
                let path = input["file_path"].as_str().or_else(|| input["notebook_path"].as_str()).unwrap_or("");
                if is_under(ops_root, path) {
                    ops_modified = true;
                }
                if path.starts_with("/etc/") && !infra.iter().any(|k| k == "etc-write") {
                    infra.push("etc-write".into());
                }
            }
            _ => {}
        }
    }
    infra.sort();
    Analysis { infra, ops_modified, prompts }
}

// ------------------------------------------------------------------ config + markers

#[derive(Debug, PartialEq, Eq)]
pub struct HookConfig {
    pub ops_root: String,
    pub keywords: Vec<String>,
}

/// Read Mochi's app config (next to the `hooks/` folder holding this binary) and the keyword list from
/// `<ops>/.mochi/config.json`. `None` when Mochi is not set up.
pub fn load_config(config_dir: &Path) -> Option<HookConfig> {
    let app: Value = serde_json::from_str(&fs::read_to_string(config_dir.join("config.json")).ok()?).ok()?;
    if app["setupComplete"] != true {
        return None;
    }
    let ops_root = app["opsMemoryPath"].as_str()?.to_string();
    let keywords = fs::read_to_string(Path::new(&ops_root).join(".mochi").join("config.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .and_then(|v| v["infraKeywords"].as_array().map(|a| a.iter().filter_map(|k| k.as_str().map(String::from)).collect::<Vec<_>>()))
        .filter(|k| !k.is_empty())
        .unwrap_or_else(default_keywords);
    Some(HookConfig { ops_root, keywords })
}

fn marker_path(config_dir: &Path, key: &str) -> PathBuf {
    let safe: String = key.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).take(120).collect();
    config_dir.join("hooks").join("markers").join(safe)
}

/// Create the marker. Returns true only if it did not exist and could be created (so the caller may act).
fn claim_marker(config_dir: &Path, key: &str) -> bool {
    let path = marker_path(config_dir, key);
    if path.exists() {
        return false;
    }
    if let Some(dir) = path.parent() {
        if fs::create_dir_all(dir).is_err() {
            return false;
        }
        // Best-effort cleanup of old markers.
        if let Ok(entries) = fs::read_dir(dir) {
            for e in entries.flatten() {
                let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|a| a.as_secs() > MARKER_MAX_AGE_SECS);
                if old == Some(true) {
                    let _ = fs::remove_file(e.path());
                }
            }
        }
    }
    fs::write(&path, b"").is_ok()
}

// ------------------------------------------------------------------ the two hooks

#[derive(Debug, PartialEq, Eq)]
pub struct Outcome {
    pub stdout: String,
    pub exit_code: i32,
}

impl Outcome {
    fn allow() -> Self {
        Outcome { stdout: String::new(), exit_code: 0 }
    }
}

pub fn block_reason(keywords: &[String], ops_root: &str) -> String {
    format!(
        "Infrastructure work was detected in this task ({}), but Ops Memory was not updated. Before finishing, follow the Ops Memory rule: update the matching file in vms/ and projects/ at {}, add a dated line to changelog/YYYY-MM.md, bump last_updated, never write secret values, or append to inbox.md if unsure which VM or project applies. (The /mochi-sync command refreshes a project's records in one go.)",
        keywords.join(", "),
        ops_root.replace('\\', "/")
    )
}

/// Stop hook. Blocks at most once per turn; fails open on any problem.
pub fn handle_stop(config_dir: &Path, stdin: &str) -> Outcome {
    let Some(input) = parse_input(stdin) else { return Outcome::allow() };
    if input.stop_hook_active {
        return Outcome::allow();
    }
    let Some(cfg) = load_config(config_dir) else { return Outcome::allow() };
    let Ok(transcript) = fs::read_to_string(&input.transcript_path) else { return Outcome::allow() };
    let a = analyze(&transcript, &cfg.ops_root, &cfg.keywords, Scope::LastTurn);
    if a.infra.is_empty() || a.ops_modified {
        return Outcome::allow();
    }
    if !claim_marker(config_dir, &format!("stop-{}-{}", input.session_id, a.prompts)) {
        return Outcome::allow();
    }
    let reason = block_reason(&a.infra, &cfg.ops_root);
    Outcome { stdout: serde_json::json!({ "decision": "block", "reason": reason }).to_string(), exit_code: 0 }
}

/// Build the inbox review line, or `None` if it would trip the secret scanner.
pub fn review_stub(date: &str, project: &str, cwd: &str, keywords: &[String]) -> Option<String> {
    let clean = |s: &str| s.replace(['\r', '\n'], " ");
    let line = format!(
        "- {date} — Review needed: infra commands ({}) ran in project \"{}\" (cwd: {}) but Ops Memory was not updated (by: mochi-hook)",
        keywords.join(", "),
        clean(project),
        clean(&cwd.replace('\\', "/"))
    );
    if crate::scanner::scan(&line).is_empty() {
        Some(line)
    } else {
        None
    }
}

fn project_name(cwd: &str) -> String {
    cwd.replace('\\', "/").trim_end_matches('/').rsplit('/').next().unwrap_or("unknown").to_string()
}

/// SessionEnd hook. Appends a review stub to inbox.md when infra work happened and Ops Memory is
/// untouched. Never blocks.
pub fn handle_session_end(config_dir: &Path, stdin: &str, date: &str) -> Outcome {
    let Some(input) = parse_input(stdin) else { return Outcome::allow() };
    let Some(cfg) = load_config(config_dir) else { return Outcome::allow() };
    let Ok(transcript) = fs::read_to_string(&input.transcript_path) else { return Outcome::allow() };
    let a = analyze(&transcript, &cfg.ops_root, &cfg.keywords, Scope::Session);
    if a.infra.is_empty() || a.ops_modified {
        return Outcome::allow();
    }
    let Some(line) = review_stub(date, &project_name(&input.cwd), &input.cwd, &a.infra) else { return Outcome::allow() };
    if !claim_marker(config_dir, &format!("end-{}", input.session_id)) {
        return Outcome::allow();
    }
    let root = Path::new(&cfg.ops_root);
    let inbox = root.join("inbox.md");
    let mut text = fs::read_to_string(&inbox).unwrap_or_else(|_| "# Inbox\n\n".to_string());
    if !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&line);
    text.push('\n');
    if fs::write(&inbox, text).is_ok() {
        // Commit so Mochi's undo (which needs a clean tree) keeps working. Best effort.
        let _ = crate::ops::run_git(root, &["add", "--", "inbox.md"]);
        let _ = if crate::ops::has_git_identity(root) {
            crate::ops::run_git(root, &["commit", "-m", "mochi-hook: review stub", "--only", "--", "inbox.md"])
        } else {
            crate::ops::run_git(
                root,
                &["-c", "user.name=Mochi", "-c", "user.email=mochi@localhost", "commit", "-m", "mochi-hook: review stub", "--only", "--", "inbox.md"],
            )
        };
    }
    Outcome::allow()
}

/// Entry point for the binary: `args` are the CLI arguments after the program name.
pub fn run(args: &[String], stdin: &str, exe: &Path, date: &str) -> Outcome {
    // exe lives in <config_dir>/hooks/mochi-hook[.exe]
    let Some(config_dir) = exe.parent().and_then(|p| p.parent()) else { return Outcome::allow() };
    match args.first().map(String::as_str) {
        Some("stop") => handle_stop(config_dir, stdin),
        Some("session-end") => handle_session_end(config_dir, stdin, date),
        _ => Outcome::allow(),
    }
}

/// Count review stubs left in inbox.md by the hook (used by the app for the alert state).
pub fn count_review_stubs(inbox: &str) -> usize {
    inbox.lines().filter(|l| l.contains("(by: mochi-hook)")).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ---- fixtures

    fn bash(cmd: &str) -> String {
        json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":cmd}}]}}).to_string()
    }
    fn write(path: &str) -> String {
        json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"t2","name":"Write","input":{"file_path":path,"content":"x"}}]}}).to_string()
    }
    fn prompt(text: &str) -> String {
        json!({"type":"user","message":{"role":"user","content":text}}).to_string()
    }
    fn tool_result() -> String {
        json!({"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}).to_string()
    }
    fn transcript(lines: &[String]) -> String {
        lines.join("\n")
    }
    fn kws() -> Vec<String> {
        default_keywords()
    }
    const OPS: &str = "D:/notes/ops-memory";

    // ---- analyze

    #[test]
    fn detects_infra_commands_and_reports_only_keyword_names() {
        let t = transcript(&[prompt("deploy"), bash("ssh deploy@10.0.0.5 'sudo systemctl restart app'"), bash("docker compose up -d")]);
        let a = analyze(&t, OPS, &kws(), Scope::Session);
        assert_eq!(a.infra, vec!["docker", "docker compose", "ssh", "systemctl"]);
        assert!(!a.ops_modified);
        assert_eq!(a.prompts, 1);
        assert!(!format!("{a:?}").contains("10.0.0.5"), "analysis must not echo command text");
    }

    #[test]
    fn no_infra_for_ordinary_dev_commands() {
        let t = transcript(&[prompt("fix"), bash("npm test"), bash("git commit -m 'fix sshd typo and dockerfile'"), bash("ls ssh-keygen-notes")]);
        assert!(analyze(&t, OPS, &kws(), Scope::Session).infra.is_empty());
    }

    #[test]
    fn keywords_match_case_insensitively_on_word_boundaries() {
        for (cmd, expect) in [
            ("SSH host", true),
            ("rsync -a . host:/x", true),
            ("echo nginx.conf", false),
            ("dockerfile", false),
            ("sudo nginx -t", true),
            ("kubectl get pods", true),
            ("pm2 restart all", true),
        ] {
            let t = transcript(&[bash(cmd)]);
            assert_eq!(!analyze(&t, OPS, &kws(), Scope::Session).infra.is_empty(), expect, "{cmd}");
        }
    }

    #[test]
    fn writes_under_etc_count_as_infra() {
        let t = transcript(&[bash("echo x | sudo tee /etc/nginx/conf.d/app.conf"), write("/etc/hosts")]);
        assert_eq!(analyze(&t, OPS, &[], Scope::Session).infra, vec!["etc-write"]);
        assert!(analyze(&transcript(&[bash("cat /etc/hosts")]), OPS, &[], Scope::Session).infra.is_empty());
    }

    #[test]
    fn detects_ops_memory_edits_via_file_tools_with_any_slash_style_and_case() {
        for path in ["D:/notes/ops-memory/vms/a.md", "D:\\notes\\ops-memory\\inbox.md", "d:/NOTES/Ops-Memory/changelog/2026-10.md"] {
            let t = transcript(&[bash("ssh h"), write(path)]);
            assert!(analyze(&t, OPS, &kws(), Scope::Session).ops_modified, "{path}");
        }
        assert!(!analyze(&transcript(&[write("D:/notes/ops-memory-other/x.md")]), OPS, &kws(), Scope::Session).ops_modified);
        assert!(!analyze(&transcript(&[write("D:/elsewhere/x.md")]), OPS, &kws(), Scope::Session).ops_modified);
    }

    #[test]
    fn detects_ops_memory_edits_via_shell_but_not_plain_reads() {
        assert!(analyze(&transcript(&[bash("echo '- x' >> D:/notes/ops-memory/inbox.md")]), OPS, &kws(), Scope::Session).ops_modified);
        assert!(analyze(&transcript(&[bash("cd D:\\notes\\ops-memory && git commit -am update")]), OPS, &kws(), Scope::Session).ops_modified);
        assert!(!analyze(&transcript(&[bash("cat D:/notes/ops-memory/vms/a.md")]), OPS, &kws(), Scope::Session).ops_modified);
    }

    #[test]
    fn last_turn_scope_ignores_earlier_turns_and_tool_results_do_not_start_turns() {
        let t = transcript(&[prompt("first"), bash("ssh old-host"), tool_result(), prompt("second"), bash("npm test"), tool_result()]);
        assert!(analyze(&t, OPS, &kws(), Scope::LastTurn).infra.is_empty());
        assert_eq!(analyze(&t, OPS, &kws(), Scope::Session).infra, vec!["ssh"]);
        assert_eq!(analyze(&t, OPS, &kws(), Scope::LastTurn).prompts, 2);

        // tool results between calls of the same turn do not reset it
        let same_turn = transcript(&[prompt("go"), bash("ssh h"), tool_result(), bash("docker ps"), tool_result()]);
        assert_eq!(analyze(&same_turn, OPS, &kws(), Scope::LastTurn).infra, vec!["docker", "ssh"]);
    }

    #[test]
    fn ops_edit_in_an_earlier_turn_does_not_excuse_the_latest_turn() {
        let t = transcript(&[prompt("a"), write("D:/notes/ops-memory/inbox.md"), prompt("b"), bash("ssh h")]);
        let a = analyze(&t, OPS, &kws(), Scope::LastTurn);
        assert!(!a.ops_modified);
        assert!(analyze(&t, OPS, &kws(), Scope::Session).ops_modified);
    }

    #[test]
    fn understands_the_simplified_docs_transcript_shape_and_survives_garbage() {
        let docs = json!({"type":"assistant","content":"x","tool_use":[{"id":"1","name":"Bash","input":{"command":"kubectl apply -f x.yaml"}}]}).to_string();
        let t = transcript(&["not json".into(), "".into(), "[1,2".into(), docs]);
        assert_eq!(analyze(&t, OPS, &kws(), Scope::Session).infra, vec!["kubectl"]);
        assert_eq!(analyze("", OPS, &kws(), Scope::Session), Analysis::default());
    }

    #[test]
    fn custom_keywords_replace_defaults_and_bad_ones_are_ignored() {
        let t = transcript(&[bash("make release-prod"), bash("ssh h")]);
        let a = analyze(&t, OPS, &["release-prod".into(), "".into(), "x".repeat(100), "(unclosed".into()], Scope::Session);
        assert_eq!(a.infra, vec!["release-prod"]);
    }

    // ---- config + hooks on disk

    struct Env {
        _tmp: tempfile::TempDir,
        config_dir: PathBuf,
        ops: PathBuf,
        transcript: PathBuf,
    }

    fn env() -> Env {
        let tmp = tempfile::tempdir().unwrap();
        let config_dir = tmp.path().join("config");
        let ops = tmp.path().join("ops-memory");
        fs::create_dir_all(&config_dir).unwrap();
        crate::ops::scaffold(&ops, "2026-10").unwrap();
        let ops_str = ops.to_string_lossy().replace('\\', "/");
        fs::write(config_dir.join("config.json"), json!({"setupComplete": true, "opsMemoryPath": ops_str}).to_string()).unwrap();
        let transcript = tmp.path().join("t.jsonl");
        Env { config_dir, ops, transcript, _tmp: tmp }
    }
    fn input(env: &Env, session: &str, active: bool) -> String {
        json!({"session_id": session, "transcript_path": env.transcript.to_string_lossy(), "cwd": "D:\\projects\\nexus-alpha", "hook_event_name": "Stop", "stop_hook_active": active}).to_string()
    }
    fn ops_str(env: &Env) -> String {
        env.ops.to_string_lossy().replace('\\', "/")
    }

    #[test]
    fn config_requires_setup_and_reads_keywords_with_fallback() {
        let e = env();
        let cfg = load_config(&e.config_dir).unwrap();
        assert_eq!(cfg.ops_root, ops_str(&e));
        assert!(cfg.keywords.contains(&"terraform".to_string()));

        fs::write(e.ops.join(".mochi/config.json"), r#"{"infraKeywords":["release-prod"]}"#).unwrap();
        assert_eq!(load_config(&e.config_dir).unwrap().keywords, vec!["release-prod"]);
        fs::write(e.ops.join(".mochi/config.json"), "{ broken").unwrap();
        assert_eq!(load_config(&e.config_dir).unwrap().keywords, default_keywords());

        fs::write(e.config_dir.join("config.json"), r#"{"setupComplete": false, "opsMemoryPath": "x"}"#).unwrap();
        assert!(load_config(&e.config_dir).is_none());
        fs::write(e.config_dir.join("config.json"), "garbage").unwrap();
        assert!(load_config(&e.config_dir).is_none());
        assert!(load_config(&e.config_dir.join("missing")).is_none());
    }

    #[test]
    fn stop_blocks_once_with_a_useful_reason_then_allows() {
        let e = env();
        fs::write(&e.transcript, transcript(&[prompt("deploy it"), bash("ssh deploy@10.0.0.5 'secret-cmd'"), bash("docker compose up -d")])).unwrap();
        let first = handle_stop(&e.config_dir, &input(&e, "s1", false));
        assert_eq!(first.exit_code, 0);
        let v: Value = serde_json::from_str(&first.stdout).unwrap();
        assert_eq!(v["decision"], "block");
        let reason = v["reason"].as_str().unwrap();
        assert!(reason.contains("docker compose") && reason.contains("ssh"));
        assert!(reason.contains(&ops_str(&e)));
        assert!(!reason.contains("10.0.0.5") && !reason.contains("secret-cmd"), "reason must not echo commands");

        let second = handle_stop(&e.config_dir, &input(&e, "s1", false));
        assert_eq!(second, Outcome::allow(), "marker prevents a second block in the same turn");
    }

    #[test]
    fn stop_hook_active_flag_always_allows() {
        let e = env();
        fs::write(&e.transcript, transcript(&[prompt("p"), bash("ssh h")])).unwrap();
        assert_eq!(handle_stop(&e.config_dir, &input(&e, "s2", true)), Outcome::allow());
        // and it did not consume the marker
        assert_ne!(handle_stop(&e.config_dir, &input(&e, "s2", false)), Outcome::allow());
    }

    #[test]
    fn stop_allows_without_infra_or_when_ops_memory_was_updated() {
        let e = env();
        fs::write(&e.transcript, transcript(&[prompt("p"), bash("npm test")])).unwrap();
        assert_eq!(handle_stop(&e.config_dir, &input(&e, "s3", false)), Outcome::allow());
        let inbox = format!("{}/inbox.md", ops_str(&e));
        fs::write(&e.transcript, transcript(&[prompt("p"), bash("ssh h"), write(&inbox)])).unwrap();
        assert_eq!(handle_stop(&e.config_dir, &input(&e, "s3", false)), Outcome::allow());
    }

    #[test]
    fn a_new_turn_in_the_same_session_can_be_nudged_again() {
        let e = env();
        fs::write(&e.transcript, transcript(&[prompt("one"), bash("ssh h")])).unwrap();
        assert_ne!(handle_stop(&e.config_dir, &input(&e, "s4", false)), Outcome::allow());
        fs::write(&e.transcript, transcript(&[prompt("one"), bash("ssh h"), prompt("two"), bash("docker ps")])).unwrap();
        assert_ne!(handle_stop(&e.config_dir, &input(&e, "s4", false)), Outcome::allow());
        assert_eq!(handle_stop(&e.config_dir, &input(&e, "s4", false)), Outcome::allow());
    }

    #[test]
    fn stop_fails_open_on_every_kind_of_bad_input() {
        let e = env();
        fs::write(&e.transcript, transcript(&[prompt("p"), bash("ssh h")])).unwrap();
        for bad in ["", "not json", "[]", "{}", "{\"session_id\": 5}", "null"] {
            assert_eq!(handle_stop(&e.config_dir, bad), Outcome::allow(), "{bad:?}");
        }
        // missing transcript
        let missing = json!({"session_id":"s5","transcript_path":"/no/such/file","stop_hook_active":false}).to_string();
        assert_eq!(handle_stop(&e.config_dir, &missing), Outcome::allow());
        // not set up
        assert_eq!(handle_stop(&e.config_dir.join("nope"), &input(&e, "s5", false)), Outcome::allow());
    }

    #[test]
    fn session_end_appends_one_committed_stub_and_never_blocks() {
        let e = env();
        fs::write(&e.transcript, transcript(&[prompt("p"), bash("ssh h"), bash("pm2 restart all")])).unwrap();
        let before: i32 = crate::ops::run_git(&e.ops, &["rev-list", "--count", "HEAD"]).unwrap().parse().unwrap();

        let out = handle_session_end(&e.config_dir, &input(&e, "e1", false), "2026-10-08");
        assert_eq!(out, Outcome::allow());
        let inbox = fs::read_to_string(e.ops.join("inbox.md")).unwrap();
        let stub = inbox.lines().last().unwrap();
        assert_eq!(count_review_stubs(&inbox), 1);
        assert!(stub.starts_with("- 2026-10-08 — Review needed: infra commands (pm2, ssh)"));
        assert!(stub.contains("project \"nexus-alpha\"") && stub.contains("D:/projects/nexus-alpha"));
        assert!(stub.ends_with("(by: mochi-hook)"));
        assert_eq!(crate::ops::run_git(&e.ops, &["status", "--porcelain"]).unwrap(), "");
        let after: i32 = crate::ops::run_git(&e.ops, &["rev-list", "--count", "HEAD"]).unwrap().parse().unwrap();
        assert_eq!(after, before + 1);

        // second call for the same session does nothing
        handle_session_end(&e.config_dir, &input(&e, "e1", false), "2026-10-08");
        assert_eq!(count_review_stubs(&fs::read_to_string(e.ops.join("inbox.md")).unwrap()), 1);
    }

    #[test]
    fn session_end_skips_when_ops_memory_was_updated_or_no_infra_or_bad_input() {
        let e = env();
        let inbox_before = fs::read_to_string(e.ops.join("inbox.md")).unwrap();
        let vm_path = format!("{}/vms/a.md", ops_str(&e));
        fs::write(&e.transcript, transcript(&[prompt("p"), bash("ssh h"), write(&vm_path)])).unwrap();
        handle_session_end(&e.config_dir, &input(&e, "e2", false), "2026-10-08");
        fs::write(&e.transcript, transcript(&[prompt("p"), bash("npm test")])).unwrap();
        handle_session_end(&e.config_dir, &input(&e, "e3", false), "2026-10-08");
        for bad in ["", "junk", "{}"] {
            assert_eq!(handle_session_end(&e.config_dir, bad, "2026-10-08"), Outcome::allow());
        }
        assert_eq!(fs::read_to_string(e.ops.join("inbox.md")).unwrap(), inbox_before);
    }

    #[test]
    fn session_end_creates_inbox_when_missing_and_scans_the_stub() {
        let e = env();
        fs::remove_file(e.ops.join("inbox.md")).unwrap();
        fs::write(&e.transcript, transcript(&[prompt("p"), bash("ssh h")])).unwrap();
        handle_session_end(&e.config_dir, &input(&e, "e4", false), "2026-10-08");
        assert!(fs::read_to_string(e.ops.join("inbox.md")).unwrap().starts_with("# Inbox\n\n- 2026-10-08"));

        assert!(review_stub("2026-10-08", "p", "D:/x", &["ssh".into()]).is_some());
        assert!(review_stub("2026-10-08", "password=Sup3rS3cret", "D:/x", &["ssh".into()]).is_none());
    }

    #[test]
    fn run_dispatches_by_subcommand_and_derives_the_config_dir_from_the_exe_path() {
        let e = env();
        fs::write(&e.transcript, transcript(&[prompt("p"), bash("ssh h")])).unwrap();
        let exe = e.config_dir.join("hooks").join("mochi-hook.exe");
        let stdin = input(&e, "r1", false);
        assert_eq!(run(&["unknown".into()], &stdin, &exe, "2026-10-08"), Outcome::allow());
        assert_eq!(run(&[], &stdin, &exe, "2026-10-08"), Outcome::allow());
        assert!(run(&["stop".into()], &stdin, &exe, "2026-10-08").stdout.contains("\"decision\":\"block\""));
        assert_eq!(run(&["session-end".into()], &stdin, &exe, "2026-10-08"), Outcome::allow());
        assert_eq!(count_review_stubs(&fs::read_to_string(e.ops.join("inbox.md")).unwrap()), 1);
    }

    #[test]
    fn counts_only_hook_stubs() {
        assert_eq!(count_review_stubs("# Inbox\n- note (by: mochi)\n- x (by: mochi-hook)\n- y (by: mochi-hook)\n"), 2);
        assert_eq!(count_review_stubs(""), 0);
    }
}
