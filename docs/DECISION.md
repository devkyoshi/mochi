# Decisions

Open decisions from the proposal (§10), with a recommended default. Status is **Proposed** until you confirm; change the status and note the date when decided.

| # | Decision | Recommended default | Why | Status |
|---|---|---|---|---|
| 1 | Mascot tech | SVG/CSS placeholder now, Rive later behind the same `<Mascot state>` API | Unblocks every other stage; Rive asset can be built separately | Proposed |
| 2 | Default Claude mode | Claude Code CLI (existing login); API key as option | Least setup, no key handling by default | Proposed |
| 3 | Push Ops Memory to a remote | No; local git only. If enabled, private repo only | Avoids leaking infra details | Proposed |
| 4 | MCP server for structured writes | Defer to v1.5 (post-v1) | Rule + hooks cover v1 | Proposed |
| 5 | SSH drift checking | Out of v1; opt-in, read-only, post-v1 | Credentials and safety surface | Proposed |

## Decided during implementation

_None yet._
