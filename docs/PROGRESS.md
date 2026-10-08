# Progress

Plan: [PLAN.md](PLAN.md). Update this file at the end of every stage. Find a stage's commit with `git log --grep "^Stage N:"`.

| # | Stage | Status | Done on |
|---|---|---|---|
| 0 | Scaffold & project brief | Done | 2026-10-08 |
| 1 | Ops Memory schema & templates | Done | 2026-10-08 |
| 2 | Secret scanner | Done | 2026-10-08 |
| 3 | Window shell (dock) | Done | 2026-10-08 |
| 4 | Mascot | Not started | |
| 5 | Setup wizard | Not started | |
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
