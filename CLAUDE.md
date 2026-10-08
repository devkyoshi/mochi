# Mochi

Cross-platform desktop assistant (Tauri v2 + React + TypeScript + Tailwind v4). An always-on-top, top-center, animated mascot dock that views/adds/updates a directory of markdown files ("Ops Memory") that Claude Code maintains about the user's VMs and deployments. Source of truth = markdown with YAML frontmatter in a user-chosen directory.

Docs: `docs/PLAN.md` (stages), `docs/PROGRESS.md` (status), `docs/DECISION.md`, `docs/MEMORY.md`, `docs/ref/desktop-assistant-proposal.md`.

## Rules
- Never store secrets in markdown, logs or config. API keys only in the OS keychain.
- File access scoped to the chosen Ops Memory directory; all filesystem access via Rust commands.
- Every write: secret scan, then a git commit in the Ops Memory repo.
- Strict TypeScript, small components, soft rounded minimal UI (shadcn-style, no neon gradients).
- Tests for parsing, secret scanning, path safety, and anything with logic.

## Commands
- `npm run tauri dev` — run the app
- `npm test` — vitest; `npm run lint`; `npm run typecheck`
- `cd src-tauri && cargo test` — Rust tests

## Workflow
- One stage = one commit, message `Stage N: <what was done>`. **No Co-Authored-By / AI attribution lines in commits** (user's explicit instruction).
- Before committing: tests, lint, typecheck all green. Update `docs/PROGRESS.md` and the README stage table.
- Do not touch the real `~/.claude` config from tests; use temp dirs.

## Layout
- `src/` React UI; `src/lib/` pure logic (tested); `src/lib/opsMemory/` schema, lossless frontmatter, INDEX gen; `src/test/` test setup
- `src/components/mascot/` mascot (SVG/CSS, states in `states.ts`; see `docs/mascot.md`)
- `src-tauri/src/ops.rs` Ops Memory dir validation + scaffold + git init; `src/components/wizard/`, `src/lib/wizard/` setup wizard
- `src-tauri/src/store.rs` safe file store (resolve_path, scan→write→commit, undo); `opsfs.rs` commands + watcher; `src/lib/ops/useOpsMemory.ts`, `src/components/{home,browse}/`
- `src/lib/opsMemory/quickAdd.ts` pure planner for Quick Add; `src/components/add/` UI (saved via `write_ops_files`, one commit)
- `templates/` Ops Memory file templates; `docs/schema.md` the schema
- `src-tauri/src/` Rust commands (`lib.rs` registers them); `scanner.rs` secret scanner (`src/lib/secretScanner.ts` wrapper); `dock.rs`/`geometry.rs`/`config.rs` dock window, placement maths, persisted settings (`src/lib/api.ts`, `src/lib/dock/`, `src/components/dock/`; see `docs/platform-notes.md`)

## Status
See `docs/PROGRESS.md`.
