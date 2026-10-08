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
| 6 | Browse / edit / search / live refresh | Not started | |
| 7 | Quick Add | Not started | |
| 8 | Claude integration | Not started | |
| 9 | Global rule & hook installer | Not started | |
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
