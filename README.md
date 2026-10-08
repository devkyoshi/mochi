# Mochi

A small animated desktop companion that lives at the top of your screen and gives you a single, current answer to *"what is deployed where, and what changed?"*

Mochi reads and edits **Ops Memory** — a git-tracked directory of markdown files about your VMs and projects — which Claude Code keeps up to date automatically from any project via a global rule and hooks.

> Status: **in development** (Stages 0-7 done). See [docs/PROGRESS.md](docs/PROGRESS.md).

## How it works

```
 Claude Code (any project) ── global rule + hooks ──▶ Ops Memory (*.md, git)
                                                          │ file watcher
                                                   Mochi (Tauri app)
                                              browse · add · chat · alerts
```

Markdown is the single source of truth. No database; everything is diff-able and undoable via git.

## Stack

Tauri v2 (Rust) · React + TypeScript + Tailwind · Rive mascot (SVG/CSS placeholder first) · `notify` file watching · MiniSearch · local git history · OS keychain for API keys.

## Stages

| # | Stage | Status |
|---|---|---|
| 0 | Scaffold & project brief | Done |
| 1 | Ops Memory schema & templates | Done |
| 2 | Secret scanner | Done |
| 3 | Window shell (dock) | Done |
| 4 | Mascot | Done |
| 5 | Setup wizard | Done |
| 6 | Browse / edit / search / live refresh | Done |
| 7 | Quick Add | Done |
| 8 | Claude integration | Not started |
| 9 | Global rule & hook installer | Not started |
| 10 | Alerts, digest, polish | Not started |
| 11 | Packaging & hardening | Not started |

Details for each stage: [docs/PLAN.md](docs/PLAN.md).

## Docs

- [docs/PLAN.md](docs/PLAN.md) — per-stage plan (goal, tasks, risks, done-when)
- [docs/PROGRESS.md](docs/PROGRESS.md) — status tracker and log
- [docs/DECISION.md](docs/DECISION.md) — open decisions and recommended defaults
- [docs/MEMORY.md](docs/MEMORY.md) — project brief and conventions for Claude sessions
- [docs/ref/desktop-assistant-proposal.md](docs/ref/desktop-assistant-proposal.md) — original proposal

## Non-negotiable rules

- Never store secret values in markdown, logs, or config — names and locations only.
- API keys live only in the OS keychain.
- File access is scoped to the chosen Ops Memory directory.
- Every write is secret-scanned and committed to the Ops Memory git repo.

## Getting started

`npm install`, then `npm run tauri dev`. Tests: `npm test` and `cd src-tauri && cargo test`. Stage plan: [docs/PLAN.md](docs/PLAN.md).
