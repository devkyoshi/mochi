# Mochi — A Desktop Ops Companion for Claude-Maintained Markdown

> Working name: **Mochi** (rename freely).
> A small animated assistant that lives at the top of your desktop, reads and edits a set of global markdown files that Claude keeps up to date, and lets you see, add, and update your VM/deployment knowledge in seconds.

---

## 1. The Problem

You work across many projects and VMs. Today:

- Deployment facts (what runs where, which version, which ports, which env changed) live in your head, scattered notes, or old chats.
- Each Claude session knows only its own project.
- There is no single, current answer to "what is deployed on VM-X and what changed last week?"

## 2. The Idea

Three parts working together:

1. **Global markdown knowledge base** ("Ops Memory") in one directory you choose.
2. **Global Claude rule + hooks** so every Claude Code session, in any project, updates that knowledge base automatically.
3. **Desktop assistant (Mochi)**: always-on-top cute companion to browse, search, add, and update the markdown files, and chat with Claude about them.

```
 ┌────────────────────┐     writes      ┌──────────────────────┐
 │ Claude Code        │ ──────────────▶ │  Ops Memory (*.md)   │
 │ (any project, any  │  global rule +  │  ~/ops-memory/       │
 │  terminal)         │  hooks          │  git-tracked         │
 └────────────────────┘                 └──────────┬───────────┘
                                                   │ file watcher
                                        ┌──────────▼───────────┐
                                        │  Mochi (Tauri app)   │
                                        │  view · add · update │
                                        │  chat · alerts       │
                                        └──────────────────────┘
```

The markdown files are the single source of truth. Both Claude and Mochi are just editors of them. No database, no lock-in, and everything is diff-able.

---

## 3. Ops Memory: Directory Layout and Schema

```
ops-memory/
├── INDEX.md                  # auto-generated overview: all VMs, projects, last-updated
├── vms/
│   ├── prod-api-01.md
│   └── staging-01.md
├── projects/
│   ├── nexus-ai.md
│   └── fuelsmart.md
├── changelog/
│   └── 2026-10.md            # append-only, newest first, one file per month
├── inbox.md                  # quick notes added from Mochi, triaged later by Claude
└── .mochi/
    ├── config.json           # non-secret settings only
    └── schema-version
```

### VM file template

```markdown
---
type: vm
name: prod-api-01
provider: <e.g. DigitalOcean / AWS / on-prem>
host: <hostname or IP>          # no passwords, keys, or tokens, ever
os: Ubuntu 24.04
last_updated: 2026-10-07
updated_by: claude-code
---

## Purpose
One or two lines.

## Deployed
| Service | Project | Version / Commit | Port | Manager | Deployed at |
|---|---|---|---|---|---|

## Config Notes
Non-secret facts: env var NAMES (not values), nginx sites, cron jobs, DB names.

## Recent Changes
- 2026-10-07 — <what> (project: X, by: claude-code)

## Open Issues / TODO
- [ ] ...
```

### Project file template

```markdown
---
type: project
name: nexus-ai
repo: <url or path>
deployed_on: [prod-api-01, staging-01]
last_updated: 2026-10-07
---

## Summary
## Stack
## Deploy Procedure
## Recent Changes
## Known Issues
```

### Hard rule: no secrets in markdown

The files are plain text, git-tracked, and read by an LLM. They store **names and references only** (e.g. "`DATABASE_URL` set in `/etc/app/.env`"), never values. Mochi should detect and refuse to save obvious secret patterns (private keys, `sk-…`, long base64, `password=`).

---

## 4. Automatic Updates from Claude (the Global Rule)

A rule alone is probabilistic: Claude may forget. So use **two layers**:

### Layer 1 — Global instruction (`~/.claude/CLAUDE.md`)

Claude Code reads a user-level `CLAUDE.md` for every project. Mochi's setup wizard appends a clearly delimited managed block (so it can update or remove it later):

```markdown
<!-- MOCHI:BEGIN (managed — do not edit inside) -->
## Ops Memory
A global knowledge base lives at: <OPS_MEMORY_PATH>

At the end of any task that deploys, configures, installs, migrates, or changes
a server, service, port, version, cron, nginx/proxy config, or env var NAMES:
1. Update the relevant file in `vms/` and `projects/` (create from template if missing).
2. Prepend a dated entry to `changelog/YYYY-MM.md`.
3. Refresh `last_updated` in frontmatter.
4. NEVER write secret values. Reference where they live instead.
5. Keep entries short, factual, and past-tense.
If unsure which VM/project applies, append to `inbox.md` instead of guessing.
<!-- MOCHI:END -->
```

### Layer 2 — Two hooks (deterministic safety net)

Claude Code supports hooks configured in `~/.claude/settings.json`. Use two, because they do different jobs:

1. **Stop hook (primary).** Runs when Claude finishes a response. A script reads the session transcript (the hook receives its path) and checks:
   - Did any command look like infra work (`ssh`, `scp`, `rsync`, `docker`, `systemctl`, `nginx`, `pm2`, `kubectl`, deploy scripts)?
   - Was any file inside Ops Memory modified?

   If infra work happened and Ops Memory was untouched, the hook **blocks the stop once** with a message telling Claude to update Ops Memory now. Claude does it while it still has full context. A loop guard (the hook input's "already continuing because of a stop hook" flag, plus a per-session marker file) ensures it fires at most once per turn.
2. **SessionEnd hook (fallback).** Cannot block anything. If Ops Memory is still untouched after infra work (Claude skipped it, or you closed the terminal), it appends a review stub to `inbox.md` with project, working directory, and timestamp. Mochi then shows the `alert` state and a badge.

Detection stays cheap and loose: pattern matching only, no LLM call. The keyword list lives in `.mochi/config.json` so you can tune false positives.

> Hook event names, which events can block, and the input shape evolve. Have Claude Code check the current hooks documentation before implementing.

### Optional Layer 3 — MCP server

Later, expose Ops Memory as a small local MCP server (`read_vm`, `update_vm`, `append_changelog`, `search`). Claude then performs structured writes instead of free-form file edits, which makes updates more consistent. Skip for v1.

---

## 5. Mochi: The Desktop Assistant

### 5.1 Reference

Your screenshot shows the target feel: a slim, notch-like dock hugging the top of the screen, with tabs (home, chat, +), settings and sound controls on the right, and a soft-glowing blob mascot with eyes and a blue "thinking" bubble. Check the GitHub repo you found for how it does the window and animations, and borrow ideas — but write your own code and assets rather than copying theirs (check its licence).

### 5.2 Recommended Stack

| Concern | Choice | Why |
|---|---|---|
| App shell | **Tauri v2** (Rust + web UI) | Small, fast, native transparent/always-on-top windows, strong filesystem scoping |
| UI | React + TypeScript + Tailwind | Fast iteration |
| Mascot animation | **Rive** (state machine) | Interactive, tiny files, eye-tracking and mood states. Fallback: Lottie or CSS/SVG |
| File watching | Rust `notify` crate | Live refresh when Claude edits files |
| Markdown | `gray-matter`-style frontmatter parsing + `react-markdown` | Render + edit |
| Search | Simple in-memory index (e.g. MiniSearch) | Enough for hundreds of files |
| History/undo | Local **git** repo inside Ops Memory | Free versioning, safe rollbacks of Claude/Mochi edits |
| Secrets | OS keychain (Tauri keyring plugin) | API key never touches disk in plaintext |

If you are already using Tauri + React elsewhere, you can reuse the same project conventions and component library.

### 5.3 Window Behavior

- Frameless, transparent, always-on-top, skip-taskbar window pinned top-center.
- **Collapsed state**: just the mascot pill (idle animation, occasional blink, eyes follow cursor).
- **Expanded state** (click or global hotkey, e.g. `Ctrl/Cmd+Shift+Space`): drops down into the dock panel with tabs.
- Click-through on transparent areas; auto-collapse on blur (configurable).
- Multi-monitor aware (remember which screen).

### 5.4 Tabs

1. **Home** — mascot, quick stats ("5 VMs · 3 changed this week · 1 stale"), recent changes, alerts.
2. **Browse** — VM and project list → rendered markdown → edit toggle (raw markdown editor with frontmatter form).
3. **Chat** — talk to Claude about your Ops Memory ("what's on staging-01?", "log that I upgraded nginx on prod-api-01 to 1.27").
4. **+ Quick Add** — fast form: pick VM/project, type a note, save → writes changelog entry (or `inbox.md`).
5. **Settings (gear)** — directory, Claude connection, hotkey, theme, sounds, re-run setup.
6. **Sound toggle** — mutes mascot chirps.

### 5.5 Mascot States (Rive state machine)

| State | Trigger | Look |
|---|---|---|
| `idle` | default | slow breathing, blinks |
| `curious` | cursor near | eyes track cursor |
| `thinking` | Claude request running | blue dots bubble (as in your screenshot) |
| `happy` | save succeeded | squish + sparkle |
| `alert` | stale VM / drift / secret detected | gentle shake + amber glow |
| `sleepy` | idle > N minutes | eyes half-closed, dims |
| `new-change` | file changed by Claude externally | little hop + badge |

### 5.6 Claude Integration

Offer two modes in setup (user picks one):

- **A. Claude Code CLI (uses your existing login/subscription).** Mochi spawns the `claude` CLI in non-interactive mode with the working directory set to Ops Memory. Least setup; reuses what you already have.
- **B. Anthropic API key.** Stored in the OS keychain; Mochi calls the API (via the Agent SDK or direct Messages API with tool use).

Safety design for both:

- Claude's file access is **scoped to the Ops Memory directory only**.
- Writes go through Mochi so it can run the secret scanner and make a git commit per change ("mochi: update prod-api-01").
- Show a diff preview before applying edits from chat (toggle "auto-apply" in settings).

> Check current docs for exact CLI flags and SDK names before implementing; they change.

### 5.7 First-Run Setup Wizard

1. **Welcome** — mascot intro.
2. **Choose directory** — native folder picker; offer "create new `ops-memory/`" or "use existing". Grants Tauri fs scope to that path only. Scaffolds the layout and `git init`.
3. **Connect Claude** — choose CLI or API key; run a test call; show success animation.
4. **Install global rule** — preview the `CLAUDE.md` block and the hook; require explicit consent; back up existing files first.
5. **Preferences** — hotkey, screen position, auto-collapse, sounds, theme.
6. **Done** — Mochi collapses to the top of the screen.

### 5.8 Smart Features (post-v1)

- **Staleness alerts**: VM not updated in N days.
- **Drift check**: compare what Ops Memory says vs. a live check over SSH (read-only, opt-in).
- **Weekly digest**: Claude summarizes the week's changelog.
- **Cross-reference view**: project → VMs → recent changes graph.
- **Export**: single combined markdown for handing to a new Claude session as context.

---

## 6. Security & Privacy Checklist

- [ ] No secret values in markdown; scanner blocks them on save.
- [ ] API key only in OS keychain.
- [ ] Tauri fs scope limited to chosen directory (+ read/write of `~/.claude/CLAUDE.md` and `settings.json` only during consented setup).
- [ ] Backups before modifying any Claude config file; managed-block markers for clean uninstall.
- [ ] Git history = audit trail and undo.
- [ ] If Ops Memory is synced/pushed anywhere, use a private repo.

---

## 7. Roadmap

| Phase | Outcome |
|---|---|
| 0 | Repo, scaffolding, schema + templates |
| 1 | Window shell: top dock, collapse/expand, hotkey |
| 2 | Mascot with Rive states |
| 3 | Setup wizard + directory scaffolding |
| 4 | Browse/view/edit/search + file watcher |
| 5 | Quick add + secret scanner + git history |
| 6 | Claude integration (chat, diff preview) |
| 7 | Global rule + hook installer |
| 8 | Alerts, digest, polish, packaging |

---

## 8. Step-by-Step Prompting Guide for Claude Code

**How to use:** open Claude Code in an empty repo folder. Run the prompts **in order**, one per session or one at a time. After each, run the app, verify the "Done when" check, then commit before moving on. Paste the output of failures back to Claude Code rather than rewriting the prompt.

### Prompt 0 — Project brief (do this first)

```
Create a CLAUDE.md in this repo with the following project brief, and keep it updated as we go.

Project: Mochi, a cross-platform desktop assistant (Tauri v2 + React + TypeScript + Tailwind).
Purpose: an always-on-top, top-center, animated cute mascot dock that views/adds/updates a
directory of markdown files ("Ops Memory") that Claude Code maintains about my VMs and
deployments. Source of truth = markdown files with YAML frontmatter, in a user-chosen directory.
Rules: never store secrets in markdown or logs; API keys only in OS keychain; file access
scoped to the chosen directory; every write creates a git commit in the Ops Memory repo.
Style: clean, minimal UI (shadcn/ui-style components), soft rounded shapes, no neon gradients.
Conventions: strict TypeScript, small components, Rust commands for all filesystem access,
tests for parsing and secret scanning.
Do not write feature code yet. Also scaffold the Tauri v2 + React + TS + Tailwind project,
verify it builds and launches, and summarize the folder structure.
```
**Done when:** `npm run tauri dev` opens a blank window.

### Prompt 1 — Ops Memory schema and templates

```
Define the Ops Memory data model. Create:
1. /docs/schema.md documenting the directory layout (INDEX.md, vms/, projects/, changelog/YYYY-MM.md,
   inbox.md, .mochi/config.json) and the frontmatter fields for vm and project files.
2. Template files in /templates for vm.md, project.md, changelog-entry format, and inbox.md.
3. A TypeScript module `src/lib/opsMemory/` with types, a frontmatter parser/serializer
   (preserve unknown fields and body exactly), and a function to generate INDEX.md from the files.
4. Unit tests (vitest) for parse → serialize round-trips and INDEX generation.
Secrets must never be part of the schema: only env var NAMES and locations.
```
**Done when:** tests pass; round-trip leaves files byte-identical.

### Prompt 2 — Secret scanner

```
Implement a secret scanner in Rust (src-tauri) and expose it as a Tauri command, plus a TS wrapper.
It takes text and returns findings (type, line, redacted preview). Detect: PEM private keys,
common API key prefixes (sk-, ghp_, AKIA, xox-, etc.), password/secret/token assignments with
literal values, JWTs, and long high-entropy strings. Provide an allowlist for placeholders
like <value>, ${VAR}, xxx. Add thorough unit tests including false-positive cases
(UUIDs, git SHAs, version strings).
```
**Done when:** tests pass; git SHAs and UUIDs aren't flagged.

### Prompt 3 — Window shell (the dock)

```
Build the window behavior. Configure the Tauri window as frameless, transparent, always-on-top,
skip-taskbar, pinned top-center of the active monitor. Implement:
- Collapsed state: a small pill (placeholder circle for now).
- Expanded state: a dock panel ~720x240 dropping from the top with an animated transition.
- Toggle via click on the pill and a global hotkey (default Ctrl/Cmd+Shift+Space, configurable later).
- Auto-collapse on blur (setting), click-through on transparent regions where supported.
- Remember position/monitor in config.
- Panel layout matching this reference: top row with tabs (Home, Chat, +) on the left and
  Settings + Sound icons on the right; content area below with rounded corners, dark theme.
Handle Windows, macOS, and Linux differences and list any platform caveats you found.
```
**Done when:** you can summon/dismiss the dock with the hotkey on your OS.

### Prompt 4 — The mascot (Rive)

```
Add the mascot using Rive (@rive-app/react-canvas). Since I don't have the .riv file yet:
1. Create a placeholder component with the same API (`<Mascot state="idle" />`) drawn with
   SVG/CSS: a soft rounded white blob with two oval eyes, subtle glow, blinking, and a blue
   "thinking" dots bubble in the top-left corner.
2. Support states: idle, curious (eyes follow cursor), thinking, happy, alert, sleepy, new-change.
3. Add a dev-only state switcher panel to preview all states.
4. Write /docs/mascot.md describing the state machine inputs so I can later build the Rive
   file at rive.app with matching state names and swap it in without changing app code.
Respect prefers-reduced-motion.
```
**Done when:** all seven states are visible and switchable.

### Prompt 5 — Directory access and setup wizard

```
Build the first-run setup wizard (full-screen-in-dock stepper, mascot guiding each step):
1. Welcome.
2. Choose directory: native folder picker; options "create new ops-memory folder" or "use existing".
   On confirm, scope Tauri fs access to ONLY that path, scaffold the layout from /templates,
   run `git init` and make an initial commit.
3. Placeholder step for Claude connection (implemented later).
4. Placeholder step for global rule install (implemented later).
5. Preferences: hotkey, auto-collapse, sounds.
6. Finish.
Persist progress and config in the app config dir (no secrets). Add "Re-run setup" in settings.
Validate that the directory is writable and not a system/home root.
```
**Done when:** fresh launch → wizard → scaffolded folder with git history.

### Prompt 6 — Browse, view, edit, search, live refresh

```
Implement the Home and Browse tabs:
- Rust commands: list/read/write files inside the Ops Memory dir only (path traversal protected),
  every write runs the secret scanner (block + show warning if findings) and creates a git commit.
- File watcher (notify crate) emitting events to the UI when files change externally (e.g. by
  Claude Code); show the `new-change` mascot state and a badge.
- Browse: sidebar of VMs/projects with last_updated, rendered markdown view, and an edit toggle
  with a raw editor + frontmatter form. Include diff-on-save and an undo-last-change button
  (git revert).
- Search across all files (MiniSearch).
- Home: stats (VM count, changed this week, stale > 30 days), recent changelog entries.
Add tests for path-traversal protection and the write→scan→commit pipeline.
```
**Done when:** editing a file in another editor makes Mochi update live; undo works.

### Prompt 7 — Quick Add

```
Implement the "+" tab. A fast form: choose VM or project (autocomplete from existing files, with
"create new from template"), type a short note, optional tag (deploy, config, incident, upgrade).
On save: prepend a dated entry to changelog/YYYY-MM.md, add it to the target file's "Recent
Changes", bump last_updated, regenerate INDEX.md. If no target is chosen, append to inbox.md.
Keyboard-first: Cmd/Ctrl+Enter saves. Trigger the `happy` mascot state on success.
```
**Done when:** a note typed in under 10 seconds lands in the right files.

### Prompt 8 — Claude integration (chat + setup step)

```
Implement Claude integration with two selectable providers behind one interface
(`ClaudeProvider.send(messages, context) -> stream`):
A) Claude Code CLI provider: spawn the `claude` CLI non-interactively with cwd = Ops Memory dir.
B) Anthropic API provider using the official SDK, key stored in the OS keychain (Tauri keyring/stronghold).
First look up the current official docs for CLI flags and SDK usage and tell me what you found.
Then:
- Fill in wizard step 3 (choose provider, enter key if needed, run a test call, success animation).
- Build the Chat tab: streaming responses, `thinking` mascot state while running.
- Restrict Claude's tools/file access to the Ops Memory directory. Edits proposed by Claude are
  shown as diffs for approval (setting for auto-apply), then written through the same
  scan→commit pipeline.
- A system prompt that explains the Ops Memory schema, the no-secrets rule, and to prefer
  inbox.md when uncertain.
```
**Done when:** "log that I upgraded nginx on prod-api-01" produces an approved diff and a commit.

### Prompt 9 — Global rule and hook installer

```
Fill in wizard step 4: install Claude Code integration with explicit consent.

FIRST: look up the current official Claude Code hooks documentation (events, which can block,
input JSON fields incl. transcript path and any "stop hook active" flag, output/exit-code
semantics) and summarize what you found before writing code. Adapt the design below if the docs differ.

1. Global rule: show a preview of the managed block to add to ~/.claude/CLAUDE.md (between
   <!-- MOCHI:BEGIN --> and <!-- MOCHI:END --> markers) with the real Ops Memory path substituted.
   It tells Claude that after any deploy/config/infra change in any project it must update vms/
   and projects/ files, prepend to changelog/YYYY-MM.md, bump last_updated, never write secret
   values, and use inbox.md when unsure. Put the wording in /docs/global-rule.md.

2. Detector script (ship it with the app, cross-platform, no heavy dependencies, e.g. Node or
   a small Rust binary). Input: hook JSON from stdin. It must:
   - read the session transcript and extract executed commands / tool calls for this turn (or session),
   - flag infra activity using a keyword/regex list loaded from <OpsMemory>/.mochi/config.json
     (defaults: ssh, scp, rsync, docker, docker compose, systemctl, nginx, pm2, kubectl, helm,
     terraform, ansible, deploy scripts, writes under /etc),
   - detect whether any file under the Ops Memory dir was modified during the session
     (check tool calls writing to that path and/or git status of the Ops Memory repo),
   - never read or log secret values; log only matched keywords and counts.

3. Stop hook (primary): if infra activity is flagged AND Ops Memory was not modified, block the
   stop ONCE with a short message instructing Claude to update Ops Memory per the global rule.
   Loop guard is mandatory: honor the hook input's stop-hook-active flag AND write a per-session
   marker file so it can never fire twice in one turn. If anything errors, fail open (allow stop).

4. SessionEnd hook (fallback): if infra activity is flagged AND Ops Memory is still unmodified,
   append a review stub to inbox.md (timestamp, project name, cwd, matched keywords). Never block.

5. Installer: back up ~/.claude/CLAUDE.md and ~/.claude/settings.json first, MERGE (never
   overwrite) existing hooks/settings, tag Mochi's entries so "Update" and "Uninstall" in Settings
   remove only Mochi's additions. Show a dry-run diff before applying.

6. Mochi side: when inbox.md gains a stub, show the `alert` mascot state and a Home badge.

7. Tests with fixture files: transcripts with/without infra commands, with/without Ops Memory edits,
   stop-hook-active true/false, malformed input (must fail open), and settings.json merge/uninstall
   round-trips preserving unrelated user hooks.
```
**Done when:** (a) a Claude Code session that deploys something and skips the update gets nudged once and then updates Ops Memory, (b) closing the terminal instead leaves an inbox stub and Mochi alerts, (c) uninstall restores your original config.

### Prompt 10 — Alerts, digest, polish

```
Add: staleness alerts (configurable N days) with the `alert` mascot state and a Home banner;
a weekly digest generated by Claude from changelog files; idle `sleepy` state; sound effects
(soft chirps, muted by toggle); launch-at-login option; tray icon with show/hide/quit;
accessibility pass (keyboard nav, focus rings, reduced motion). Then update README and /docs.
```

### Prompt 11 — Packaging and hardening

```
Prepare release builds for Windows, macOS, and Linux with Tauri bundler, auto-update plan,
and a security review: audit fs scopes/capabilities, CSP, IPC commands, shell invocation
(argument injection), and secret handling. Produce /docs/security-review.md with findings
and fix anything high or medium severity.
```

---

## 9. Tips for Working With Claude Code on This

- **One prompt, one commit.** Ask Claude Code to commit after each prompt with a clear message.
- **Plan mode first** for Prompts 3, 8, and 9 (platform quirks and config merging are the risky parts).
- **Paste real errors**, not summaries.
- **Keep CLAUDE.md current**: after each phase, ask "update CLAUDE.md with what we learned and current status".
- **Design assets**: build the Rive mascot separately (rive.app); the placeholder in Prompt 4 lets everything else proceed.

## 10. Open Decisions

1. Rive vs. Lottie vs. pure CSS/SVG for the mascot.
2. CLI mode vs. API-key mode as the default for Claude.
3. Whether Ops Memory is ever pushed to a private remote repo (and where).
4. Whether to add the MCP server in v1.5 for structured writes.
5. SSH drift checking: in scope or not.
