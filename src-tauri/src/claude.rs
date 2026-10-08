//! Claude providers. Two interchangeable backends stream text back to the UI:
//!  - `cli`: the user's installed Claude Code CLI, run non-interactively (prompt on stdin, fixed args).
//!  - `api`: the Anthropic Messages API over HTTPS, with the key kept in the OS keychain.
//!
//! Claude never gets file tools from Mochi: it only returns text. Proposed edits are parsed in the UI and
//! applied through the scan -> commit pipeline after the user approves a diff.

use crate::dock::AppState;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

pub const API_URL: &str = "https://api.anthropic.com/v1/messages";
pub const API_VERSION: &str = "2023-06-01";
pub const DEFAULT_MODEL: &str = "claude-sonnet-5-5";
const MAX_TOKENS: u32 = 4096;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);
const KEYRING_SERVICE: &str = "mochi";
const KEYRING_USER: &str = "anthropic-api-key";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum StreamEvent {
    Text { text: String },
    Done,
    Error { message: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

// ------------------------------------------------------------------ pure helpers

/// A model id may only contain safe characters (it becomes a CLI argument).
pub fn valid_model(model: &str) -> bool {
    !model.is_empty()
        && model.len() <= 80
        && model.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        && !model.starts_with('-')
}

/// Fixed argument list for the CLI. The prompt is NOT an argument (it is written to stdin).
pub fn cli_args(model: Option<&str>) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    if let Some(m) = model {
        if !valid_model(m) {
            return Err("Invalid model name.".into());
        }
        args.push("--model".into());
        args.push(m.to_string());
    }
    Ok(args)
}

/// Text sent to the CLI on stdin: instructions plus the conversation.
pub fn cli_prompt(system: &str, messages: &[ChatMessage]) -> String {
    let mut out = String::new();
    out.push_str(system);
    out.push_str("\n\n---\nConversation:\n");
    for m in messages {
        let who = if m.role == "assistant" { "Assistant" } else { "User" };
        out.push_str(&format!("\n[{who}]\n{}\n", m.content));
    }
    out.push_str("\nReply as the Assistant to the last User message. Do not use any tools.\n");
    out
}

/// Parse one `stream-json` line from the CLI. `got_text` tracks whether any text was already emitted
/// so the final `result` is only used as a fallback.
pub fn parse_cli_line(line: &str, got_text: &mut bool) -> Vec<StreamEvent> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else { return vec![] };
    match v["type"].as_str() {
        Some("stream_event") => {
            let ev = &v["event"];
            if ev["type"] == "content_block_delta" && ev["delta"]["type"] == "text_delta" {
                if let Some(t) = ev["delta"]["text"].as_str() {
                    *got_text = true;
                    return vec![StreamEvent::Text { text: t.to_string() }];
                }
            }
            vec![]
        }
        Some("assistant") if !*got_text => {
            let text: String = v["message"]["content"]
                .as_array()
                .map(|blocks| blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect())
                .unwrap_or_default();
            if text.is_empty() {
                vec![]
            } else {
                *got_text = true;
                vec![StreamEvent::Text { text }]
            }
        }
        Some("result") => {
            let result = v["result"].as_str().unwrap_or("");
            if v["is_error"].as_bool().unwrap_or(false) {
                vec![StreamEvent::Error { message: friendly_cli_error(result) }]
            } else if !*got_text && !result.is_empty() {
                *got_text = true;
                vec![StreamEvent::Text { text: result.to_string() }]
            } else {
                vec![]
            }
        }
        _ => vec![],
    }
}

fn friendly_cli_error(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("not logged in") || lower.contains("login") || lower.contains("authenticat") {
        "Claude Code is not logged in. Run `claude` in a terminal and sign in, then try again.".into()
    } else if raw.trim().is_empty() {
        "Claude Code returned an error.".into()
    } else {
        raw.trim().chars().take(300).collect()
    }
}

/// Find the Claude CLI executable in `path_var` (a PATH-style string).
pub fn find_claude(path_var: &str) -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["claude.exe", "claude.cmd"] } else { &["claude"] };
    for dir in std::env::split_paths(path_var) {
        for n in names {
            let candidate = dir.join(n);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// JSON body for the Messages API.
pub fn api_body(model: &str, system: &str, messages: &[ChatMessage]) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": messages,
        "stream": true,
    })
}

/// Parse the JSON `data:` payload of one SSE event from the Messages API.
pub fn parse_sse_data(data: &str) -> Option<StreamEvent> {
    let v: serde_json::Value = serde_json::from_str(data).ok()?;
    match v["type"].as_str()? {
        "content_block_delta" if v["delta"]["type"] == "text_delta" => {
            Some(StreamEvent::Text { text: v["delta"]["text"].as_str()?.to_string() })
        }
        "message_stop" => Some(StreamEvent::Done),
        "error" => Some(StreamEvent::Error {
            message: v["error"]["message"].as_str().unwrap_or("The request failed.").chars().take(300).collect(),
        }),
        _ => None,
    }
}

/// Incremental Server-Sent-Events splitter: feed raw chunks, get complete `data:` payloads.
#[derive(Default)]
pub struct SseBuffer {
    buf: String,
}

impl SseBuffer {
    pub fn push(&mut self, chunk: &str) -> Vec<String> {
        self.buf.push_str(&chunk.replace("\r\n", "\n"));
        let mut out = Vec::new();
        while let Some(pos) = self.buf.find("\n\n") {
            let event: String = self.buf.drain(..pos + 2).collect();
            let data: Vec<&str> = event.lines().filter_map(|l| l.strip_prefix("data:")).map(|d| d.trim_start()).collect();
            if !data.is_empty() {
                out.push(data.join("\n"));
            }
        }
        out
    }
}

/// User-facing message for a non-success API status. Never includes the key.
pub fn api_error_message(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(|s| s.chars().take(200).collect::<String>()));
    match status {
        401 | 403 => "The API key was rejected. Check the key in Settings.".into(),
        429 => "Rate limited by the API. Wait a moment and try again.".into(),
        529 | 500..=599 => "The API is temporarily unavailable. Try again shortly.".into(),
        _ => format!("API error ({status}){}", detail.map(|d| format!(": {d}")).unwrap_or_default()),
    }
}

// ------------------------------------------------------------------ keychain

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

pub fn valid_key_format(key: &str) -> bool {
    let k = key.trim();
    k.len() >= 20 && k.len() <= 400 && !k.chars().any(|c| c.is_whitespace() || c.is_control())
}

#[tauri::command]
pub fn claude_save_key(key: String) -> Result<(), String> {
    if !valid_key_format(&key) {
        return Err("That does not look like an API key.".into());
    }
    entry()?.set_password(key.trim()).map_err(|e| format!("Could not store the key in the OS keychain: {e}"))
}

#[tauri::command]
pub fn claude_has_key() -> bool {
    entry().and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()
}

#[tauri::command]
pub fn claude_delete_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ------------------------------------------------------------------ runners

type Cancel = tokio::sync::oneshot::Receiver<()>;

/// Run the CLI at `exe` with `cwd` as working directory, forwarding events to `emit`.
pub async fn run_cli(
    exe: &Path,
    cwd: &Path,
    model: Option<&str>,
    system: &str,
    messages: &[ChatMessage],
    emit: &(dyn Fn(StreamEvent) + Send + Sync),
    mut cancel: Cancel,
) -> Result<(), String> {
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(cli_args(model)?)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    let mut child = cmd.spawn().map_err(|e| format!("Could not start Claude Code: {e}"))?;

    let mut stdin = child.stdin.take().ok_or("no stdin")?;
    let prompt = cli_prompt(system, messages);
    tokio::spawn(async move {
        let _ = stdin.write_all(prompt.as_bytes()).await;
        let _ = stdin.shutdown().await;
    });
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;
    let err_task = tokio::spawn(async move {
        let mut s = String::new();
        let _ = (&mut stderr).take(4000).read_to_string(&mut s).await;
        s
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut got_text = false;
    let mut errored = false;
    let work = async {
        while let Ok(Some(line)) = lines.next_line().await {
            for ev in parse_cli_line(&line, &mut got_text) {
                if matches!(ev, StreamEvent::Error { .. }) {
                    errored = true;
                }
                emit(ev);
            }
        }
    };
    tokio::select! {
        _ = work => {}
        _ = &mut cancel => { let _ = child.kill().await; emit(StreamEvent::Done); return Ok(()); }
        _ = tokio::time::sleep(REQUEST_TIMEOUT) => { let _ = child.kill().await; return Err("Claude Code took too long to answer.".into()); }
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;
    if !status.success() && !errored {
        let stderr_text = err_task.await.unwrap_or_default();
        return Err(friendly_cli_error(&stderr_text));
    }
    if !errored {
        emit(StreamEvent::Done);
    }
    Ok(())
}

/// Call the Messages API at `url`, forwarding events to `emit`.
pub async fn run_api(
    url: &str,
    key: &str,
    model: &str,
    system: &str,
    messages: &[ChatMessage],
    emit: &(dyn Fn(StreamEvent) + Send + Sync),
    mut cancel: Cancel,
) -> Result<(), String> {
    if !valid_model(model) {
        return Err("Invalid model name.".into());
    }
    let client = reqwest::Client::builder().timeout(REQUEST_TIMEOUT).build().map_err(|e| e.to_string())?;
    let resp = client
        .post(url)
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .json(&api_body(model, system, messages))
        .send()
        .await
        .map_err(|e| if e.is_timeout() { "The request timed out.".to_string() } else { "Could not reach the API. Check your connection.".to_string() })?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(api_error_message(status.as_u16(), &body));
    }

    let mut stream = resp.bytes_stream();
    let mut sse = SseBuffer::default();
    let mut finished = false;
    loop {
        tokio::select! {
            _ = &mut cancel => { emit(StreamEvent::Done); return Ok(()); }
            next = stream.next() => match next {
                None => break,
                Some(Err(_)) => return Err("The connection was interrupted.".into()),
                Some(Ok(bytes)) => {
                    for data in sse.push(&String::from_utf8_lossy(&bytes)) {
                        if let Some(ev) = parse_sse_data(&data) {
                            let stop = matches!(ev, StreamEvent::Done | StreamEvent::Error { .. });
                            emit(ev);
                            if stop { finished = true; }
                        }
                    }
                    if finished { return Ok(()); }
                }
            }
        }
    }
    if !finished {
        emit(StreamEvent::Done);
    }
    Ok(())
}

// ------------------------------------------------------------------ commands

fn settings(state: &State<AppState>) -> Result<(String, PathBuf), String> {
    let cfg = state.config.lock().map_err(|e| e.to_string())?;
    let provider = cfg.claude_provider.clone().ok_or("Claude is not connected yet.")?;
    let root = cfg.ops_memory_path.clone().ok_or("Ops Memory is not set up yet.")?;
    Ok((provider, PathBuf::from(root)))
}

async fn run_provider(
    provider: &str,
    cwd: &Path,
    system: &str,
    messages: &[ChatMessage],
    emit: &(dyn Fn(StreamEvent) + Send + Sync),
    cancel: Cancel,
) -> Result<(), String> {
    match provider {
        "cli" => {
            let path_var = std::env::var("PATH").unwrap_or_default();
            let exe = find_claude(&path_var)
                .ok_or("Claude Code was not found. Install it, or switch to an API key in Settings.")?;
            run_cli(&exe, cwd, None, system, messages, emit, cancel).await
        }
        "api" => {
            let key = entry()?
                .get_password()
                .map_err(|_| "No API key is saved. Add one in Settings.".to_string())?;
            run_api(API_URL, &key, DEFAULT_MODEL, system, messages, emit, cancel).await
        }
        _ => Err("Unknown Claude provider.".into()),
    }
}

/// Stream a chat reply. Events arrive on `claude://<request_id>` as `StreamEvent`s.
#[tauri::command]
pub async fn claude_send(
    app: AppHandle,
    state: State<'_, AppState>,
    request_id: String,
    system: String,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    if !request_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') || request_id.is_empty() {
        return Err("Invalid request id.".into());
    }
    let (provider, root) = settings(&state)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    state.claude_cancels.lock().map_err(|e| e.to_string())?.insert(request_id.clone(), tx);

    let channel = format!("claude://{request_id}");
    let handle = app.clone();
    let emit_channel = channel.clone();
    let emit = move |ev: StreamEvent| {
        let _ = handle.emit(&emit_channel, ev);
    };
    let result = run_provider(&provider, &root, &system, &messages, &emit, rx).await;
    if let Ok(mut m) = app.state::<AppState>().claude_cancels.lock() {
        m.remove(&request_id);
    }
    if let Err(message) = &result {
        let _ = app.emit(&channel, StreamEvent::Error { message: message.clone() });
    }
    result
}

#[tauri::command]
pub fn claude_cancel(state: State<AppState>, request_id: String) {
    if let Ok(mut m) = state.claude_cancels.lock() {
        if let Some(tx) = m.remove(&request_id) {
            let _ = tx.send(());
        }
    }
}

/// Test a provider with a tiny request. `provider` is "cli" or "api" (uses the saved key).
#[tauri::command]
pub async fn claude_test(provider: String) -> Result<String, String> {
    let (_tx, rx) = tokio::sync::oneshot::channel();
    let text = std::sync::Mutex::new(String::new());
    let error = std::sync::Mutex::new(None::<String>);
    let emit = |ev: StreamEvent| match ev {
        StreamEvent::Text { text: t } => text.lock().unwrap().push_str(&t),
        StreamEvent::Error { message } => *error.lock().unwrap() = Some(message),
        StreamEvent::Done => {}
    };
    let cwd = std::env::temp_dir();
    let messages = [ChatMessage { role: "user".into(), content: "Reply with the single word: ok".into() }];
    run_provider(&provider, &cwd, "You are a connection test. Do not use tools.", &messages, &emit, rx).await?;
    if let Some(e) = error.lock().unwrap().take() {
        return Err(e);
    }
    let reply = text.lock().unwrap().trim().to_string();
    if reply.is_empty() {
        Err("Claude returned an empty reply.".into())
    } else {
        Ok(reply)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    fn collect() -> (Arc<Mutex<Vec<StreamEvent>>>, impl Fn(StreamEvent) + Send + Sync) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let e2 = events.clone();
        (events, move |ev| e2.lock().unwrap().push(ev))
    }
    fn texts(events: &[StreamEvent]) -> String {
        events.iter().filter_map(|e| if let StreamEvent::Text { text } = e { Some(text.as_str()) } else { None }).collect()
    }
    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage { role: role.into(), content: content.into() }
    }

    // ---- model / args / prompt

    #[test]
    fn model_names_are_validated() {
        for ok in ["claude-sonnet-5-5", "claude-haiku-4-5-20251001", "a.b_c-1"] {
            assert!(valid_model(ok), "{ok}");
        }
        for bad in ["", "-rf", "a b", "a;b", "a$(x)", "a\nb", "../x", &"x".repeat(81)] {
            assert!(!valid_model(bad), "{bad:?}");
        }
    }

    #[test]
    fn cli_args_are_fixed_and_never_contain_the_prompt() {
        let args = cli_args(None).unwrap();
        assert_eq!(args, ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages"]);
        let with_model = cli_args(Some("claude-sonnet-5-5")).unwrap();
        assert_eq!(&with_model[5..], ["--model", "claude-sonnet-5-5"]);
        assert!(cli_args(Some("x; rm -rf /")).is_err());
    }

    #[test]
    fn cli_prompt_includes_system_conversation_and_no_tools_instruction() {
        let p = cli_prompt("SYSTEM", &[msg("user", "hi"), msg("assistant", "hello"), msg("user", "log it")]);
        assert!(p.starts_with("SYSTEM"));
        assert!(p.contains("[User]\nhi"));
        assert!(p.contains("[Assistant]\nhello"));
        assert!(p.contains("[User]\nlog it"));
        assert!(p.contains("Do not use any tools"));
    }

    // ---- cli stream parsing

    #[test]
    fn parses_text_deltas() {
        let mut got = false;
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}}"#;
        assert_eq!(parse_cli_line(line, &mut got), vec![StreamEvent::Text { text: "Hel".into() }]);
        assert!(got);
    }

    #[test]
    fn ignores_init_other_events_garbage_and_empty_lines() {
        let mut got = false;
        for line in [
            r#"{"type":"system","subtype":"init","session_id":"x"}"#,
            r#"{"type":"stream_event","event":{"type":"message_start"}}"#,
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{}"}}}"#,
            "not json",
            "",
        ] {
            assert!(parse_cli_line(line, &mut got).is_empty(), "{line}");
        }
        assert!(!got);
    }

    #[test]
    fn falls_back_to_assistant_message_then_result_when_no_deltas() {
        let mut got = false;
        let a = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi "},{"type":"tool_use","name":"x"},{"type":"text","text":"there"}]}}"#;
        assert_eq!(parse_cli_line(a, &mut got), vec![StreamEvent::Text { text: "Hi there".into() }]);
        // result is not duplicated once text was seen
        assert!(parse_cli_line(r#"{"type":"result","result":"Hi there","is_error":false}"#, &mut got).is_empty());

        let mut got2 = false;
        let r = r#"{"type":"result","result":"only result","is_error":false}"#;
        assert_eq!(parse_cli_line(r, &mut got2), vec![StreamEvent::Text { text: "only result".into() }]);
    }

    #[test]
    fn assistant_message_is_ignored_after_deltas_to_avoid_duplicates() {
        let mut got = true;
        let a = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"dup"}]}}"#;
        assert!(parse_cli_line(a, &mut got).is_empty());
    }

    #[test]
    fn error_results_become_friendly_errors() {
        let mut got = false;
        let r = r#"{"type":"result","result":"Error: Not logged in. Run claude login","is_error":true}"#;
        match parse_cli_line(r, &mut got).as_slice() {
            [StreamEvent::Error { message }] => assert!(message.contains("not logged in")),
            other => panic!("{other:?}"),
        }
        let generic = r#"{"type":"result","result":"Something odd","is_error":true}"#;
        assert_eq!(parse_cli_line(generic, &mut false), vec![StreamEvent::Error { message: "Something odd".into() }]);
    }

    // ---- finding the CLI

    #[test]
    fn finds_claude_on_a_path_and_returns_none_otherwise() {
        let dir = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) { "claude.cmd" } else { "claude" };
        assert!(find_claude(dir.path().to_str().unwrap()).is_none());
        std::fs::write(dir.path().join(name), "x").unwrap();
        let other = tempfile::tempdir().unwrap();
        let joined = std::env::join_paths([other.path(), dir.path()]).unwrap();
        assert_eq!(find_claude(joined.to_str().unwrap()).unwrap(), dir.path().join(name));
    }

    // ---- api request / sse

    #[test]
    fn api_body_has_required_fields() {
        let b = api_body("claude-sonnet-5-5", "sys", &[msg("user", "hi")]);
        assert_eq!(b["model"], "claude-sonnet-5-5");
        assert_eq!(b["stream"], true);
        assert_eq!(b["system"], "sys");
        assert_eq!(b["messages"][0], serde_json::json!({"role": "user", "content": "hi"}));
        assert!(b["max_tokens"].as_u64().unwrap() > 0);
    }

    #[test]
    fn sse_data_events_parse() {
        let d = r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}"#;
        assert_eq!(parse_sse_data(d), Some(StreamEvent::Text { text: "Hi".into() }));
        assert_eq!(parse_sse_data(r#"{"type":"message_stop"}"#), Some(StreamEvent::Done));
        assert_eq!(
            parse_sse_data(r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#),
            Some(StreamEvent::Error { message: "Overloaded".into() })
        );
        for ignored in [r#"{"type":"ping"}"#, r#"{"type":"message_start","message":{}}"#, r#"{"type":"content_block_delta","delta":{"type":"input_json_delta"}}"#, "garbage"] {
            assert_eq!(parse_sse_data(ignored), None, "{ignored}");
        }
    }

    #[test]
    fn sse_buffer_handles_split_chunks_crlf_and_multiple_events() {
        let mut b = SseBuffer::default();
        assert!(b.push("event: content_block_delta\nda").is_empty());
        assert_eq!(b.push("ta: {\"a\":1}\n\nevent: ping\ndata: {\"b\":2}\r\n\r\n"), vec!["{\"a\":1}", "{\"b\":2}"]);
        assert!(b.push("data: partial").is_empty());
        assert_eq!(b.push("\n\n"), vec!["partial"]);
    }

    #[test]
    fn api_errors_are_friendly_and_never_leak_the_key() {
        assert!(api_error_message(401, r#"{"error":{"message":"invalid x-api-key sk-ant-SECRET"}}"#).contains("rejected"));
        assert!(!api_error_message(401, "sk-ant-SECRET").contains("SECRET"));
        assert!(api_error_message(429, "").contains("Rate limited"));
        assert!(api_error_message(529, "").contains("unavailable"));
        assert_eq!(api_error_message(400, r#"{"error":{"message":"bad field"}}"#), "API error (400): bad field");
    }

    #[test]
    fn key_format_check() {
        assert!(valid_key_format("sk-ant-api03-abcdefghijklmnop"));
        assert!(!valid_key_format("short"));
        assert!(!valid_key_format("has space inside the key value here"));
        assert!(!valid_key_format(&"x".repeat(401)));
    }

    // ---- runners against fakes

    fn serve_once(response: String, capture: Arc<Mutex<String>>) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = vec![0u8; 65536];
            let mut total = 0;
            loop {
                let n = sock.read(&mut buf[total..]).unwrap();
                total += n;
                let text = String::from_utf8_lossy(&buf[..total]).to_string();
                if let Some(idx) = text.find("\r\n\r\n") {
                    let len = text.to_lowercase().split("content-length:").nth(1).and_then(|r| r.trim().split("\r\n").next().and_then(|n| n.trim().parse::<usize>().ok())).unwrap_or(0);
                    if total >= idx + 4 + len {
                        *capture.lock().unwrap() = text;
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            sock.write_all(response.as_bytes()).unwrap();
        });
        format!("http://{addr}/v1/messages")
    }

    fn sse_response(body: &str) -> String {
        format!("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len())
    }

    #[tokio::test]
    async fn api_runner_streams_text_and_sends_the_right_request() {
        let body = concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hel\"}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"lo\"}}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
        );
        let captured = Arc::new(Mutex::new(String::new()));
        let url = serve_once(sse_response(body), captured.clone());
        let (events, emit) = collect();
        let (_tx, rx) = tokio::sync::oneshot::channel();
        run_api(&url, "sk-ant-test-key-1234567890", "claude-sonnet-5-5", "SYS", &[msg("user", "hi")], &emit, rx).await.unwrap();

        let events = events.lock().unwrap().clone();
        assert_eq!(texts(&events), "Hello");
        assert_eq!(events.last(), Some(&StreamEvent::Done));
        let req = captured.lock().unwrap().to_lowercase();
        assert!(req.contains("x-api-key: sk-ant-test-key-1234567890"));
        assert!(req.contains("anthropic-version: 2023-06-01"));
        assert!(req.contains("\"stream\":true"));
    }

    #[tokio::test]
    async fn api_runner_maps_http_errors_without_leaking_the_key() {
        let body = r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        let resp = format!("HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
        let url = serve_once(resp, Arc::new(Mutex::new(String::new())));
        let (events, emit) = collect();
        let (_tx, rx) = tokio::sync::oneshot::channel();
        let err = run_api(&url, "sk-ant-test-key-1234567890", "claude-sonnet-5-5", "S", &[msg("user", "hi")], &emit, rx).await.unwrap_err();
        assert!(err.contains("rejected"));
        assert!(!err.contains("sk-ant"));
        assert!(events.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn api_runner_reports_unreachable_servers() {
        let (_events, emit) = collect();
        let (_tx, rx) = tokio::sync::oneshot::channel();
        let err = run_api("http://127.0.0.1:1/v1/messages", "k", "claude-sonnet-5-5", "S", &[], &emit, rx).await.unwrap_err();
        assert!(err.contains("Could not reach"));
    }

    #[tokio::test]
    async fn api_runner_rejects_bad_model_before_any_request() {
        let (_events, emit) = collect();
        let (_tx, rx) = tokio::sync::oneshot::channel();
        assert!(run_api("http://127.0.0.1:1/", "k", "bad model", "S", &[], &emit, rx).await.is_err());
    }

    fn fake_cli(dir: &Path, lines: &[&str], exit_code: i32) -> PathBuf {
        if cfg!(windows) {
            let path = dir.join("claude.cmd");
            let mut script = String::from("@echo off\r\n");
            for l in lines {
                script.push_str(&format!("echo {l}\r\n"));
            }
            script.push_str(&format!("exit /b {exit_code}\r\n"));
            std::fs::write(&path, script).unwrap();
            path
        } else {
            let path = dir.join("claude");
            let mut script = String::from("#!/bin/sh\ncat >/dev/null\n");
            for l in lines {
                script.push_str(&format!("printf '%s\\n' '{l}'\n"));
            }
            script.push_str(&format!("exit {exit_code}\n"));
            std::fs::write(&path, script).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            path
        }
    }

    #[tokio::test]
    async fn cli_runner_streams_text_from_a_fake_cli() {
        let dir = tempfile::tempdir().unwrap();
        let exe = fake_cli(
            dir.path(),
            &[
                r#"{"type":"system","subtype":"init"}"#,
                r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}}"#,
                r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}}"#,
                r#"{"type":"result","result":"Hi there","is_error":false}"#,
            ],
            0,
        );
        let (events, emit) = collect();
        let (_tx, rx) = tokio::sync::oneshot::channel();
        run_cli(&exe, dir.path(), None, "SYS", &[msg("user", "hi")], &emit, rx).await.unwrap();
        let events = events.lock().unwrap().clone();
        assert_eq!(texts(&events), "Hi there");
        assert_eq!(events.last(), Some(&StreamEvent::Done));
    }

    #[tokio::test]
    async fn cli_runner_reports_error_results_once() {
        let dir = tempfile::tempdir().unwrap();
        let exe = fake_cli(dir.path(), &[r#"{"type":"result","result":"Not logged in","is_error":true}"#], 1);
        let (events, emit) = collect();
        let (_tx, rx) = tokio::sync::oneshot::channel();
        run_cli(&exe, dir.path(), None, "S", &[msg("user", "hi")], &emit, rx).await.unwrap();
        let events = events.lock().unwrap().clone();
        assert_eq!(events.len(), 1);
        assert!(matches!(&events[0], StreamEvent::Error { message } if message.contains("not logged in")));
    }

    #[tokio::test]
    async fn cli_runner_fails_on_nonzero_exit_without_output() {
        let dir = tempfile::tempdir().unwrap();
        let exe = fake_cli(dir.path(), &[], 3);
        let (_events, emit) = collect();
        let (_tx, rx) = tokio::sync::oneshot::channel();
        assert!(run_cli(&exe, dir.path(), None, "S", &[msg("user", "hi")], &emit, rx).await.is_err());
    }

    #[tokio::test]
    async fn cli_runner_rejects_invalid_model_and_missing_executable() {
        let dir = tempfile::tempdir().unwrap();
        let (_events, emit) = collect();
        let (_tx, rx) = tokio::sync::oneshot::channel();
        assert!(run_cli(&dir.path().join("nope"), dir.path(), None, "S", &[], &emit, rx).await.is_err());
        let (_tx2, rx2) = tokio::sync::oneshot::channel();
        assert!(run_cli(&dir.path().join("nope"), dir.path(), Some("a b"), "S", &[], &emit, rx2).await.unwrap_err().contains("model"));
    }
}
