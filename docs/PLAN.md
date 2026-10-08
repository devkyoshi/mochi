# Mochi — Staged Implementation Plan

Source: [desktop-assistant-proposal.md](ref/desktop-assistant-proposal.md). This merges the proposal's Roadmap (phases 0-8) with its Prompt guide (Prompts 0-11) into 12 stages (0-11).

**Rules for every stage**
- One stage = one commit (after the Done-when check passes).
- Update [PROGRESS.md](PROGRESS.md) and the repo `CLAUDE.md` when finished.
- Tests for any parsing / scanning / path logic. No secrets in markdown, logs, or config. Paste real errors back, not summaries.
- Check the security checklist (proposal §6) when a stage touches fs scope, keys, or Claude config.

---

## Stage 0 — Scaffold & project brief
*Prompt 0 · Phase 0*
- **Goal:** Empty but building Tauri v2 + React + TypeScript + Tailwind app, with a project brief.
- **Tasks:** Create repo `CLAUDE.md` (brief, rules, conventions); scaffold the app; verify build and launch; summarize folder structure; `git init`.
- **Files:** `CLAUDE.md`, `package.json`, `src/`, `src-tauri/`, `tailwind` config.
- **Risks:** Windows toolchain (Rust, MSVC build tools, WebView2).
- **Done when:** `npm run tauri dev` opens a blank window.

## Stage 1 — Ops Memory schema & templates
*Prompt 1*
- **Goal:** Define the data model: `INDEX.md`, `vms/`, `projects/`, `changelog/YYYY-MM.md`, `inbox.md`, `.mochi/config.json`.
- **Tasks:** `docs/schema.md`; `/templates` (vm, project, changelog entry, inbox); `src/lib/opsMemory/` with types, frontmatter parser/serializer (preserve unknown fields and body exactly), INDEX generator; vitest tests.
- **Risks:** Round-trip fidelity (line endings, key order, comments in YAML).
- **Done when:** Tests pass; parse → serialize leaves files byte-identical.

## Stage 2 — Secret scanner
*Prompt 2*
- **Goal:** Block secret values from ever being saved.
- **Tasks:** Rust scanner in `src-tauri` + Tauri command + TS wrapper. Detect PEM keys, key prefixes (`sk-`, `ghp_`, `AKIA`, `xox-`), `password/secret/token=` literals, JWTs, high-entropy strings. Placeholder allowlist (`<value>`, `${VAR}`, `xxx`). Return type, line, redacted preview.
- **Risks:** False positives on UUIDs, git SHAs, versions; findings must never echo the full secret.
- **Done when:** Tests pass; SHAs and UUIDs are not flagged.

## Stage 3 — Window shell (the dock)
*Prompt 3 · Phase 1 · use plan mode first*
- **Goal:** Frameless, transparent, always-on-top, skip-taskbar window pinned top-center.
- **Tasks:** Collapsed pill / expanded ~720x240 panel with animation; toggle by click and global hotkey (default Ctrl/Cmd+Shift+Space); auto-collapse on blur; click-through on transparent areas; remember monitor/position; panel layout (tabs Home/Chat/+ left, Settings/Sound right, dark rounded). Document Windows/macOS/Linux caveats.
- **Risks:** Transparency and click-through differ per OS; Linux Wayland limits always-on-top and global hotkeys; hotkey conflicts.
- **Done when:** Hotkey summons and dismisses the dock on the dev OS.

## Stage 4 — Mascot
*Prompt 4 · Phase 2*
- **Goal:** `<Mascot state="..." />` with the final API, drawn with SVG/CSS until a Rive file exists.
- **Tasks:** Seven states (idle, curious, thinking, happy, alert, sleepy, new-change); eye tracking; thinking-bubble; dev-only state switcher; `docs/mascot.md` describing the Rive state-machine inputs; respect `prefers-reduced-motion`.
- **Risks:** Swapping to Rive later must not change app code.
- **Done when:** All seven states are visible and switchable.

## Stage 5 — Directory access & setup wizard
*Prompt 5 · Phase 3*
- **Goal:** First-run wizard that creates a scaffolded, git-initialised Ops Memory folder.
- **Tasks:** Steps: Welcome → Choose directory (create new / use existing, folder picker) → Claude placeholder → Global-rule placeholder → Preferences → Finish. Scope Tauri fs to the chosen path only; scaffold from `/templates`; `git init` + initial commit; persist config in the app config dir; "Re-run setup" in Settings; reject non-writable, system, or home-root paths.
- **Risks:** fs scope must be granted at runtime for exactly one path.
- **Done when:** Fresh launch → wizard → scaffolded folder with git history.

## Stage 6 — Browse, edit, search, live refresh
*Prompt 6 · Phase 4*
- **Goal:** Home and Browse tabs working on real files.
- **Tasks:** Rust list/read/write inside the directory only (traversal-safe); every write runs scan → commit; `notify` watcher emits events (`new-change` mascot + badge); Browse sidebar, rendered markdown, raw editor + frontmatter form, diff-on-save, undo-last-change (git revert); MiniSearch; Home stats (VM count, changed this week, stale > 30 days) and recent changes. Tests for traversal protection and the write→scan→commit pipeline.
- **Risks:** Watcher echoing Mochi's own writes; symlink escapes; Windows path normalization.
- **Done when:** Editing a file in another editor updates Mochi live; undo works.

## Stage 7 — Quick Add
*Prompt 7 · Phase 5*
- **Goal:** Capture a note in under 10 seconds.
- **Tasks:** "+" tab with target autocomplete (or create from template), note, tag (deploy/config/incident/upgrade); on save prepend to `changelog/YYYY-MM.md`, add to target's Recent Changes, bump `last_updated`, regenerate INDEX; no target → `inbox.md`; Ctrl/Cmd+Enter; `happy` state.
- **Done when:** A typed note lands in the right files in under 10 seconds.

## Stage 8 — Claude integration (chat + setup step)
*Prompt 8 · Phase 6 · use plan mode first*
- **Goal:** Chat with Claude about Ops Memory, with safe edits.
- **Tasks:** Look up current CLI flags and SDK docs first and report them. `ClaudeProvider.send(messages, context) -> stream` with (A) Claude Code CLI provider (non-interactive, cwd = Ops Memory) and (B) Anthropic API provider (key in OS keychain). Wizard step 3 with test call. Chat tab with streaming and `thinking` state. File access limited to Ops Memory; proposed edits shown as diffs for approval (auto-apply setting) and written via scan → commit. System prompt covering schema, no-secrets, prefer `inbox.md` when unsure.
- **Risks:** CLI argument injection; tool scoping; API key leaking to logs or disk.
- **Done when:** "log that I upgraded nginx on prod-api-01" produces an approved diff and a commit.

## Stage 9 — Global rule & hook installer
*Prompt 9 · Phase 7 · use plan mode first*
- **Goal:** Every Claude Code session, in any project, keeps Ops Memory current.
- **Tasks:** Read current hooks docs first and summarize. Managed block in `~/.claude/CLAUDE.md` between `MOCHI:BEGIN/END` (wording in `docs/global-rule.md`); cross-platform detector script (keywords from `.mochi/config.json`, never logs secret values); **Stop hook** (block once if infra work and no Ops Memory edit; honor stop-hook-active flag + per-session marker; fail open); **SessionEnd hook** (append review stub to `inbox.md`, never block); installer with backups, merge-not-overwrite, tagged entries, dry-run diff, update/uninstall; `alert` state + Home badge on new stub; fixture tests (with/without infra, with/without edits, flag true/false, malformed input, merge/uninstall round-trip).
- **Risks:** Hook schema drift; clobbering the user's existing hooks/settings; infinite stop loops.
- **Done when:** (a) a deploy session that skips the update is nudged once, then updates Ops Memory; (b) closing the terminal leaves an inbox stub and Mochi alerts; (c) uninstall restores the original config.

## Stage 10 — Alerts, digest, polish
*Prompt 10 · Phase 8*
- **Goal:** Make it pleasant for daily use.
- **Tasks:** Staleness alerts (configurable N days) + Home banner; weekly digest by Claude from changelogs; `sleepy` idle state; soft sounds with mute; launch-at-login; tray (show/hide/quit); accessibility (keyboard nav, focus rings, reduced motion); update README and docs.
- **Done when:** Stale VM triggers `alert`; digest generates; app is fully keyboard-usable.

## Stage 11 — Packaging & hardening
*Prompt 11 · Phase 8*
- **Goal:** Shippable builds.
- **Tasks:** Tauri bundles for Windows/macOS/Linux; auto-update plan; security review of fs scopes/capabilities, CSP, IPC commands, shell invocation, secret handling → `docs/security-review.md`; fix all high/medium findings.
- **Done when:** Installable builds on each OS; no open high/medium findings.

---

## Post-v1 backlog
MCP server for structured writes (`read_vm`, `update_vm`, `append_changelog`, `search`) · opt-in read-only SSH drift check · cross-reference graph · export combined markdown as context · private remote sync.
