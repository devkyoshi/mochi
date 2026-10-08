//! Runs the real `mochi-hook` binary as a child process, the way Claude Code does:
//! JSON on stdin, decision on stdout, exit code 0 in every case.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

struct Setup {
    _tmp: tempfile::TempDir,
    hook_exe: PathBuf,
    ops: PathBuf,
    transcript: PathBuf,
}

fn setup() -> Setup {
    let tmp = tempfile::tempdir().unwrap();
    let config_dir = tmp.path().join("config");
    let hooks_dir = config_dir.join("hooks");
    fs::create_dir_all(&hooks_dir).unwrap();
    let hook_exe = hooks_dir.join(Path::new(env!("CARGO_BIN_EXE_mochi-hook")).file_name().unwrap());
    fs::copy(env!("CARGO_BIN_EXE_mochi-hook"), &hook_exe).unwrap();

    let ops = tmp.path().join("ops-memory");
    fs::create_dir_all(ops.join(".mochi")).unwrap();
    fs::write(ops.join("inbox.md"), "# Inbox\n\n").unwrap();
    for args in [vec!["init", "-q", "-b", "main"], vec!["config", "user.name", "t"], vec!["config", "user.email", "t@t"], vec!["add", "-A"], vec!["commit", "-qm", "init"]] {
        assert!(Command::new("git").args(&args).current_dir(&ops).status().unwrap().success());
    }
    let ops_str = ops.to_string_lossy().replace('\\', "/");
    fs::write(
        config_dir.join("config.json"),
        serde_json::json!({ "setupComplete": true, "opsMemoryPath": ops_str }).to_string(),
    )
    .unwrap();
    let transcript = tmp.path().join("session.jsonl");
    Setup { _tmp: tmp, hook_exe, ops, transcript }
}

fn run(exe: &Path, sub: &str, stdin: &str) -> (i32, String, String) {
    let mut child = Command::new(exe).arg(sub).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(stdin.as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    (out.status.code().unwrap(), String::from_utf8_lossy(&out.stdout).into_owned(), String::from_utf8_lossy(&out.stderr).into_owned())
}

fn tool_line(name: &str, input: serde_json::Value) -> String {
    serde_json::json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"x","name":name,"input":input}]}}).to_string()
}

fn hook_input(s: &Setup, session: &str, active: bool) -> String {
    serde_json::json!({
        "session_id": session,
        "transcript_path": s.transcript.to_string_lossy(),
        "cwd": "/home/me/billing-api",
        "hook_event_name": "Stop",
        "stop_hook_active": active
    })
    .to_string()
}

fn write_transcript(s: &Setup, lines: &[String]) {
    fs::write(&s.transcript, lines.join("\n")).unwrap();
}

#[test]
fn stop_hook_nudges_once_and_then_lets_claude_stop() {
    let s = setup();
    let prompt = serde_json::json!({"type":"user","message":{"role":"user","content":"deploy to staging"}}).to_string();
    write_transcript(&s, &[prompt, tool_line("Bash", serde_json::json!({"command": "ssh deploy@staging 'docker compose pull && docker compose up -d'"}))]);

    let (code, stdout, _) = run(&s.hook_exe, "stop", &hook_input(&s, "sess-1", false));
    assert_eq!(code, 0);
    let v: serde_json::Value = serde_json::from_str(&stdout).expect("stdout is JSON");
    assert_eq!(v["decision"], "block");
    assert!(v["reason"].as_str().unwrap().contains("Ops Memory"));

    // Claude Code re-runs the hook with stop_hook_active=true after the nudge: must allow.
    let (code, stdout, _) = run(&s.hook_exe, "stop", &hook_input(&s, "sess-1", true));
    assert_eq!((code, stdout.as_str()), (0, ""));
    // Even without the flag the per-turn marker prevents a second block.
    let (code, stdout, _) = run(&s.hook_exe, "stop", &hook_input(&s, "sess-1", false));
    assert_eq!((code, stdout.as_str()), (0, ""));
}

#[test]
fn stop_hook_is_quiet_after_ops_memory_was_updated() {
    let s = setup();
    let prompt = serde_json::json!({"type":"user","message":{"role":"user","content":"deploy"}}).to_string();
    let inbox = format!("{}/inbox.md", s.ops.to_string_lossy().replace('\\', "/"));
    write_transcript(
        &s,
        &[prompt, tool_line("Bash", serde_json::json!({"command": "ssh host uptime"})), tool_line("Write", serde_json::json!({"file_path": inbox, "content": "x"}))],
    );
    assert_eq!(run(&s.hook_exe, "stop", &hook_input(&s, "sess-2", false)), (0, String::new(), String::new()));
}

#[test]
fn session_end_leaves_a_review_stub_in_the_inbox() {
    let s = setup();
    let prompt = serde_json::json!({"type":"user","message":{"role":"user","content":"restart"}}).to_string();
    write_transcript(&s, &[prompt, tool_line("Bash", serde_json::json!({"command": "pm2 restart all"}))]);

    let (code, stdout, _) = run(&s.hook_exe, "session-end", &hook_input(&s, "sess-3", false));
    assert_eq!((code, stdout.as_str()), (0, ""));
    let inbox = fs::read_to_string(s.ops.join("inbox.md")).unwrap();
    assert!(inbox.contains("Review needed: infra commands (pm2)"), "{inbox}");
    assert!(inbox.contains("project \"billing-api\""));
    assert!(inbox.trim_end().ends_with("(by: mochi-hook)"));
}

#[test]
fn every_kind_of_bad_input_fails_open() {
    let s = setup();
    for sub in ["stop", "session-end", "bogus"] {
        for stdin in ["", "garbage", "{}", "[1,2,3]", "{\"transcript_path\": \"/nonexistent\"}"] {
            assert_eq!(run(&s.hook_exe, sub, stdin), (0, String::new(), String::new()), "{sub} / {stdin:?}");
        }
    }
    // not set up at all: binary lives in a folder with no config.json
    let lonely = tempfile::tempdir().unwrap();
    let exe = lonely.path().join("hooks").join(s.hook_exe.file_name().unwrap());
    fs::create_dir_all(exe.parent().unwrap()).unwrap();
    fs::copy(&s.hook_exe, &exe).unwrap();
    assert_eq!(run(&exe, "stop", &hook_input(&s, "x", false)), (0, String::new(), String::new()));
}
