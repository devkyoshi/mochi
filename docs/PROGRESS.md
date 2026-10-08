# Progress

Plan: [PLAN.md](PLAN.md). Update this file at the end of every stage. Find a stage's commit with `git log --grep "^Stage N:"`.

| # | Stage | Status | Done on |
|---|---|---|---|
| 0 | Scaffold & project brief | Done | 2026-10-08 |
| 1 | Ops Memory schema & templates | Done | 2026-10-08 |
| 2 | Secret scanner | Done | 2026-10-08 |
| 3 | Window shell (dock) | Done | 2026-10-08 |
| 4 | Mascot | Done | 2026-10-08 |
| 5 | Setup wizard | Done | 2026-10-08 |
| 6 | Browse / edit / search / live refresh | Done | 2026-10-08 |
| 7 | Quick Add | Done | 2026-10-08 |
| 8 | Claude integration | Done (live calls not verified) | 2026-10-08 |
| 9 | Global rule & hook installer | Done (not run in a live Claude session) | 2026-10-08 |
| 10 | Alerts, digest, polish | Not started | |
| 11 | Packaging & hardening | Not started | |

## Log

- 2026-10-08 — Reviewed the proposal; wrote PLAN.md, README, DECISION.md, MEMORY.md, PROGRESS.md. No code yet.
- 2026-10-08 — Stage 0: Tauri v2 + React + TS + Tailwind v4 scaffold, vitest + eslint, CLAUDE.md; tests/lint/typecheck green; app window launches.
- 2026-10-08 — Stage 1: schema doc, templates, lossless frontmatter parser/editor, entry validation, INDEX generator; 56 new vitest tests (57 total).
- 2026-10-08 — Stage 2: Rust secret scanner (`scan_secrets` command) + TS wrapper; 23 cargo tests incl. false-positive cases (UUID, git SHA, versions, paths); 3 new vitest tests.
- 2026-10-08 — Stage 3: frameless always-on-top dock, pill/panel with animation, global hotkey, auto-collapse, monitor memory, settings persistence; 15 new cargo tests, 13 new vitest tests. Manual check of transparency/hotkey on screen still advisable; click-through replaced by window resizing (see platform-notes).
- 2026-10-08 — Stage 4: SVG/CSS `<Mascot>` with 7 states, cursor-tracking eyes, reduced-motion support, dev state switcher on Home (dev builds), docs/mascot.md with Rive contract; 13 new vitest tests (87 total).
- 2026-10-08 — Stage 5: first-run wizard (6 steps), native folder picker, Rust directory validation (rejects roots, system dirs, home and parents, unwritable, files, `..`), idempotent scaffold from templates + `git init` + initial commit, Re-run setup in Settings; 13 new cargo tests, 22 new vitest tests (109 vitest / 51 cargo). Claude and global-rule steps are placeholders. fs access stays in Rust commands (no fs plugin scope needed).
- 2026-10-08 — Stage 6: traversal-safe Rust store (list/read/write/undo/history), write→scan→commit pipeline (commits only the written file), notify watcher with self-write filtering, Home stats + recent changes, Browse (markdown view, raw editor + frontmatter form, diff review, undo), MiniSearch. Repos created by Mochi set `core.autocrlf=false` so reverts keep LF. Expanded panel height raised 240→420 for Browse. Verified live: external edits in a temp Ops Memory folder were reported by the watcher in the running app (txt files ignored). 20 new cargo tests (71), 47 new vitest tests (156).
- 2026-10-08 — Stage 7: Quick Add tab. Pure planner (`planQuickAdd`) builds changelog line (newest first, new month file from template), target Recent Changes bullet, `last_updated`/`updated_by`, regenerated INDEX, or inbox append; new VM/project created from templates. Saved through new all-or-nothing `write_ops_files` as ONE commit (undo reverts the whole note). Ctrl/Cmd+Enter saves; happy mascot for 2s. 6 new cargo tests (77), 29 new vitest tests (185).
- 2026-10-08 — Stage 8: Claude integration (see docs/claude-integration.md). CLI and API providers behind one interface, key in OS keychain, streaming Chat tab with `thinking` mascot, edits only as reviewed diffs (auto-apply setting) through scan→commit, wizard step 3 + Settings with test call. 22 new cargo tests (99; fake CLI process and local fake HTTP server), 34 new vitest tests (219). NOT verified live: real `claude` run, real API call, real keychain (need the user's login/key). Some CLI flags from the docs lookup were deliberately not used because unverified.
- 2026-10-08 — Stage 9: global rule + hooks (see docs/global-rule.md). Installer merges/uninstalls the CLAUDE.md block and Stop/SessionEnd hooks (exec form, backups, dry-run diff, consent UI in wizard step 4 and Settings, invalid settings.json never touched); `mochi-hook` binary: Stop blocks once per turn with loop guard + marker and fails open, SessionEnd appends a committed inbox stub; Home banner + `alert` mascot when stubs exist. Tests only used temp dirs; your real ~/.claude was not modified. 45 new cargo tests (148 incl. 4 process-level tests of the real binary), 13 new vitest tests (230). NOT verified: a real Claude Code session running the hooks; hook binary packaging for releases (Stage 11).
