# Project memory (for Claude sessions)

**Mochi** — cross-platform desktop assistant (Tauri v2 + React + TypeScript + Tailwind). An always-on-top, top-center animated mascot dock to view/add/update **Ops Memory**: a user-chosen directory of markdown files (YAML frontmatter) about VMs and deployments, kept current by Claude Code via a global rule + Stop/SessionEnd hooks.

## Where things are
- Plan by stage: [PLAN.md](PLAN.md) · status: [PROGRESS.md](PROGRESS.md) · decisions: [DECISION.md](DECISION.md)
- Full proposal: [ref/desktop-assistant-proposal.md](ref/desktop-assistant-proposal.md)

## Rules
- Never store secret values in markdown, logs, or config; names and locations only.
- API keys only in the OS keychain.
- File access scoped to the chosen Ops Memory directory; all filesystem access through Rust commands.
- Every write: secret scan → git commit in the Ops Memory repo.
- Strict TypeScript, small components, soft rounded minimal UI (no neon gradients); tests for parsing, secret scanning, path safety.

## Workflow
- One stage = one commit. Update PROGRESS.md (and CLAUDE.md once it exists) after each stage.
- Use plan mode for Stages 3, 8, 9. Before Stages 8 and 9, look up the current Claude Code CLI/SDK/hooks docs; do not rely on the proposal's wording.
- Hosting: this project has no VM/domain yet (nothing to record in `PROJECT_VMS.md`).
