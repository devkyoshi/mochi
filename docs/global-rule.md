# Global rule and hooks (Claude Code integration)

Goal: every Claude Code session, in any project, keeps Ops Memory current. A rule alone is probabilistic, so there are two layers. Nothing is installed without the user previewing a diff and agreeing; existing files are backed up first.

Code: `src-tauri/src/install.rs` (installer), `hook.rs` + `src/bin/mochi-hook.rs` (hook helper), `integration.rs` (Tauri commands), `src/components/integration/GlobalRuleSetup.tsx` (consent UI, in wizard step 4 and Settings).

## Layer 1: the rule (`~/.claude/CLAUDE.md`)
The block in `templates/global-rule.md`, with the real Ops Memory path substituted, between `<!-- MOCHI:BEGIN ... -->` and `<!-- MOCHI:END -->`. It tells Claude to update `vms/` and `projects/`, prepend to `changelog/YYYY-MM.md`, bump `last_updated`, never write secret values, and use `inbox.md` when unsure. Install replaces an existing block in place; uninstall removes the block and its blank separator line. Files keep their line endings (CRLF stays CRLF). A file with no trailing newline gains one.

## Layer 2: hooks (`~/.claude/settings.json`)
Written in exec form (`command` + `args`, no shell) because the default Windows shell is PowerShell, where a quoted path followed by arguments does not run:

```json
{ "hooks": {
  "Stop":       [ { "hooks": [ { "type": "command", "command": "C:/.../com.mochi.desktop/hooks/mochi-hook.exe", "args": ["stop"],        "timeout": 10 } ] } ],
  "SessionEnd": [ { "hooks": [ { "type": "command", "command": "C:/.../com.mochi.desktop/hooks/mochi-hook.exe", "args": ["session-end"], "timeout": 10 } ] } ]
} }
```

Mochi's entries are recognised by `mochi-hook` in the command (the docs define no tag field). The installer merges: all other settings and hooks are preserved, key order and indent are kept, an invalid `settings.json` is never touched, and uninstall removes only Mochi's entries.

### `mochi-hook stop` (blocks at most once per turn)
Reads the hook JSON (`session_id`, `transcript_path`, `cwd`, `stop_hook_active`). It allows (exit 0, no output) when: `stop_hook_active` is true; Mochi is not set up; the transcript is unreadable; no infra activity was found in the current turn; or Ops Memory was modified. Otherwise it claims a per-session-per-turn marker file and prints `{"decision":"block","reason":...}` once. Any error fails open.

### `mochi-hook session-end` (never blocks)
If the whole session had infra activity and Ops Memory was untouched, appends one review line ending in `(by: mochi-hook)` to `inbox.md` and commits it (once per session, via a marker). Mochi then shows the `alert` mascot and a Home banner while stubs remain.

### Detection
Pattern matching over the JSONL transcript: Bash/PowerShell commands matched against the keyword list in `<Ops Memory>/.mochi/config.json` (`infraKeywords`; defaults ssh, scp, rsync, docker, docker compose, systemctl, nginx, pm2, kubectl, helm, terraform, ansible), plus writes under `/etc`. Matching is case-insensitive on word boundaries (`nginx.conf` and `dockerfile` do not match). Ops Memory counts as modified when a Write/Edit/MultiEdit/NotebookEdit targets a file inside it, or a shell command that writes mentions its path. The hook outputs only keyword names and counts, never command text, and never logs.

## Facts from the docs lookup (2026-10-08)
Stop input includes `stop_hook_active`; blocking = JSON `decision: block` on stdout (or exit 2 + stderr); hook timeouts do not block. SessionEnd cannot block and has a short default budget (we use 10 s and finish in milliseconds). Stop takes no matcher. User-level `~/.claude/CLAUDE.md` loads in every project. The docs do not fully specify the transcript schema, so the parser is lenient (finds any `{name, input}` tool call) and was tested against both real-style and simplified shapes.

## Limits and notes
- The transcript can lag behind the conversation, so the Stop hook may occasionally miss the very latest tool call (it then allows).
- The hook helper ships with the app as a Tauri sidecar (`bundle.externalBin`, built by `npm run prepare:hook`) and sits next to the app executable; the installer copies it to `<app config dir>/hooks/`. `tauri dev` builds it automatically. See `docs/release.md`.
- Not verified live: a real Claude Code session running the installed hooks (needs a manual run; tests cover the binary as a child process with real JSON on stdin).

## Stage 13 additions

- The rule now also asks Claude to keep **Storage**, **Live site** (`vm`, `domain`, `live_url`, `live`) and **Dev Logins** (table, Password cell always `keychain`) current, and to tell the user to set new passwords in Mochi.
- Layer 3: the **`/mochi-sync`** slash command (`~/.claude/commands/mochi-sync.md`, template `templates/mochi-sync-command.md`). Run it inside a project to have Claude inspect the repo and refresh that project's and VM's records. It is installed, updated and removed together with the rule; the file carries a `MOCHI:COMMAND` marker, and a user's own `mochi-sync.md` without the marker is never overwritten or deleted.
- Mochi compares the installed rule block and command with the current templates and shows "out of date" in Settings so users can preview and apply the update (backups as before).
