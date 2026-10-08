# Mochi

A small animated desktop companion that lives at the top of your screen and gives you a single, current answer to *"what is deployed where, and what changed?"*

Mochi reads and edits **Ops Memory**: a git-tracked folder of markdown notes about your VMs and projects. Claude Code can keep those notes up to date automatically, from any project, through an optional global rule and two hooks.

> Status: **in development**. All 12 planned stages are built (see [docs/PROGRESS.md](docs/PROGRESS.md) for what has and has not been verified). Windows is the only platform it has been built and run on so far.

```
 Claude Code (any project) ── global rule + hooks ──▶ Ops Memory (*.md, git)
                                                          │ file watcher
                                                   Mochi (Tauri app)
                                              browse · add · chat · alerts
```

Markdown is the single source of truth. There is no database; everything is diff-able and undoable through git.

---

## Quick start

```bash
git clone <this repo> && cd personal-assistant
make dev          # installs npm packages, then builds and runs the app
```

The first run compiles the whole Rust side and takes **several minutes**; later runs start in seconds. When it is up, look at the **top-centre of your screen** for a small pill with a white blob. Click it, or press **Ctrl+Shift+Space** (Cmd+Shift+Space on macOS). The setup wizard opens on first run. `Esc` closes the panel.

No `make`? Run `npm install` and then `npm run tauri dev`.

---

## Prerequisites

You need these on your machine to develop or build Mochi. Versions in brackets are what it was built and tested with.

| Tool | Needed for | Notes |
|---|---|---|
| **Node.js 22 or newer** [24.16] with npm [11] | frontend, scripts | <https://nodejs.org> |
| **Rust, stable** [1.98] via rustup | the app backend | <https://rustup.rs>. On Windows pick the default `x86_64-pc-windows-msvc` toolchain |
| **git** [2.54] | development **and at runtime** | Mochi runs `git` to commit your notes. It must be on `PATH` |
| **make** (optional) | the `make dev` shortcuts | Everything also works through `npm run …`. Windows: `choco install make` or GnuWin32 |
| **Claude Code** (optional) | "Claude Code" chat mode, and the hooks | <https://claude.com/claude-code>, signed in. Not needed if you use an API key |
| **Anthropic API key** (optional) | "API key" chat mode | stored in your OS keychain, never in a file |

Platform specifics:

- **Windows 10/11**: Visual Studio **Build Tools** with the *Desktop development with C++* workload (MSVC + Windows SDK), and the **WebView2 runtime** (already present on Windows 11 and up-to-date Windows 10). Installing the Rust MSVC toolchain will point you at the build tools if they are missing.
- **macOS**: Xcode Command Line Tools (`xcode-select --install`).
- **Linux**: WebKitGTK and friends, plus a Secret Service provider (GNOME Keyring or KWallet) for the API-key storage:
  ```bash
  sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
    librsvg2-dev libdbus-1-dev libssl-dev patchelf pkg-config build-essential
  ```
  Wayland compositors may ignore always-on-top, window positioning and global shortcuts; X11 works fully (see [docs/platform-notes.md](docs/platform-notes.md)).

Quick check that everything is in place:

```bash
node -v && npm -v && rustc --version && cargo --version && git --version
```

---

## Everyday commands

| Command | What it does |
|---|---|
| `make dev` | Run the desktop app with hot reload for the UI. Frees port 1420 first if an old dev server is stuck |
| `make stop` | Stop the app and any leftover dev server |
| `make web` | UI only, in a browser (files, git and Claude do not work there; for styling work) |
| `make check` | Everything that must be green before a commit: vitest, ESLint, TypeScript, `cargo test` |
| `make test` / `make rust-test` | Frontend tests / Rust tests |
| `make lint` / `make typecheck` | ESLint / TypeScript |
| `make build` | Release build and an installer for **your** OS (`src-tauri/target/release/bundle/`) |
| `make hook` | Build the Claude Code hook helper (done automatically by `dev` and `build`) |
| `make clean` | Delete build output (`dist`, `src-tauri/target`, `src-tauri/binaries`) |
| `make help` | List all of the above |

Each has an npm equivalent: `npm run tauri dev`, `npm test`, `npm run lint`, `npm run typecheck`, `npm run tauri build`, and `cd src-tauri && cargo test`.

### What happens on `make dev`
1. `npm install` runs if `package.json` or the lockfile changed.
2. `scripts/free-port.mjs` stops a stale Node dev server on port 1420, if there is one (Vite uses a fixed port).
3. `npm run prepare:hook` builds the small `mochi-hook` helper (see below).
4. Vite serves the UI and Cargo builds and launches the app window.

### Where Mochi keeps things
| What | Where |
|---|---|
| App settings (no secrets) | `%APPDATA%\com.mochi.desktop\config.json` on Windows, `~/Library/Application Support/com.mochi.desktop/` on macOS, `~/.config/com.mochi.desktop/` on Linux |
| Your notes (Ops Memory) | the folder you pick in the wizard; a normal git repo |
| Anthropic API key | the OS keychain (service `mochi`) |
| Hook helper (once installed) | `<settings folder>/hooks/mochi-hook[.exe]` |
| Claude Code files it edits (only after you approve a preview) | `~/.claude/CLAUDE.md` and `~/.claude/settings.json`, with `*.mochi-backup-<time>` copies next to them |

---

## First-run walkthrough

1. **Welcome** → **Choose directory**: create a new `ops-memory` folder inside a parent you pick, or use an existing folder. Mochi refuses drive roots, system folders and your home folder, scaffolds the layout, and makes the first git commit.
2. **Connect Claude** (skippable): choose *Claude Code* (uses your existing login) or *API key*, then **Test connection**.
3. **Claude Code integration** (skippable): preview the exact changes to `~/.claude/CLAUDE.md` and `settings.json`, tick the consent box, install. You can update or remove it later in Settings.
4. **Preferences**: shortcut, collapse-on-blur, sounds. **Finish**.

Then use the tabs: **Home** (counts, stale entries, recent changes, alerts, weekly digest), **Browse** (view, edit with a diff review, search, undo), **Chat**, **Quick add** (a note in seconds; `Ctrl/Cmd+Enter` saves), **Settings**. The tray icon offers Open, Show/hide dock and Quit.

### How the Claude Code integration works
- A short managed block in `~/.claude/CLAUDE.md` tells Claude, in every project, to update your notes after server work and never to write secret values.
- A **Stop** hook nudges Claude once if it did infrastructure work (ssh, docker, systemctl, …) without updating the notes; a **SessionEnd** hook leaves a review line in `inbox.md` if it still did not. Mochi then shows an alert.
- Everything fails open, and removing it restores your original files. Details: [docs/global-rule.md](docs/global-rule.md).

---

## Building an installer

```bash
make build        # or: npm run tauri build
```
Produces, for the OS you run it on, an installer under `src-tauri/target/release/bundle/` (Windows: NSIS `Mochi_0.1.0_x64-setup.exe`). Installers cannot be cross-built; the GitHub workflow builds all three OSes on a version tag. Code signing and auto-update are not set up yet: see [docs/release.md](docs/release.md).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `make dev` finishes compiling but I see no window | The window is a small pill at the **top-centre** of the monitor under your cursor. Press `Ctrl+Shift+Space`. Check the tray icon too ("Show / hide dock") |
| "Port 1420 is already in use" | `make stop`, then `make dev` (the latter now does this itself). If another program owns the port, close it |
| Shortcut does nothing | Another app owns `Ctrl+Shift+Space`; the pill still opens by click. Set a different shortcut in the wizard preferences |
| `error: linker 'link.exe' not found` / missing MSVC | Install Visual Studio Build Tools with the C++ workload, then reopen the terminal |
| Blank window on Windows | Install or update the WebView2 runtime |
| `cargo`/`rustc` not found | Install rustup and restart the terminal so `PATH` updates |
| "Could not run git" | Install git and make sure `git --version` works in the same terminal |
| Test connection: "Claude Code was not found" | Install Claude Code and make sure `claude` runs in a terminal, or use an API key instead |
| Test connection: "not logged in" | Run `claude` once in a terminal and sign in |
| "Could not store the key in the OS keychain" (Linux) | Install and unlock a Secret Service provider (GNOME Keyring / KWallet) |
| "The hook helper was not found next to the app" | Run `make hook` (or just `make dev`), then retry the install in Settings |
| Settings from an older build are gone | The app identifier changed to `com.mochi.desktop` in Stage 11; re-run the wizard once |
| Start over | `make stop`, delete the settings folder (table above), run `make dev`. Your notes folder is untouched |

To remove the Claude Code integration: Settings → *Claude Code integration* → **Preview removal** → **Remove**.

---

## Project layout

```
src/                     React + TypeScript UI
  components/            dock, wizard, home, browse, add, chat, integration, mascot
  lib/                   pure logic with tests: opsMemory (parsing, index, quick add), claude, dock, ops
src-tauri/
  src/                   Rust: store (safe file access + git), scanner (secrets), claude (CLI/API), install + hook (Claude Code integration), dock, tray, config
  src/bin/mochi-hook.rs  the helper Claude Code runs (Stop / SessionEnd)
  tests/                 process-level tests of the hook binary
templates/               files Mochi creates (vm, project, changelog, inbox, global rule)
scripts/                 prepare-hook.mjs (sidecar build), free-port.mjs
docs/                    design, security and release documentation
.github/workflows/       CI and draft-release workflows
```

Stack: Tauri v2 (Rust) · React · TypeScript · Tailwind v4 · vitest · `notify` file watching · MiniSearch · `keyring` · git for history. The mascot is SVG/CSS with a documented contract for swapping in a Rive file later.

## Rules the code enforces

- Secret values never go into notes, logs or config; every write is scanned and blocked if it looks like a secret.
- API keys live only in the OS keychain.
- File access is confined to the chosen Ops Memory folder; every change is its own git commit and can be undone.
- Claude gets no file tools: it proposes edits as diffs that you approve (or auto-apply, if you turn that on).

## Contributing workflow

One stage or change per commit, message `Stage N: …` or a plain summary. Run `make check` first; tests must never touch the real `~/.claude` (use temp folders). Conventions for AI sessions are in [CLAUDE.md](CLAUDE.md) and [docs/MEMORY.md](docs/MEMORY.md).

## Docs

- Design: [schema](docs/schema.md) · [mascot](docs/mascot.md) · [platform notes](docs/platform-notes.md) · [Claude integration](docs/claude-integration.md) · [global rule and hooks](docs/global-rule.md)
- Safety and shipping: [security review](docs/security-review.md) · [release guide](docs/release.md)
- Planning: [stage plan](docs/PLAN.md) · [progress](docs/PROGRESS.md) · [decisions](docs/DECISION.md) · [original proposal](docs/ref/desktop-assistant-proposal.md)

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
| 8 | Claude integration | Done |
| 9 | Global rule & hook installer | Done |
| 10 | Alerts, digest, polish | Done |
| 11 | Packaging & hardening | Done |
