# Security review (Stage 11)

Date: 2026-10-08. Scope: the whole app at the end of Stage 11: Tauri capabilities and plugins, CSP, IPC commands, process spawning (git, Claude CLI), secret handling, the Claude Code installer and hook helper, and the web UI. Method: code read-through of every Rust command and every place that spawns a process or writes outside the app folder; automated tests for each fix; and a **live check of the production binary** (see below).

## Threat model
- The user is trusted. Notes (Ops Memory) are **not**: they may contain text from the internet, from Claude, or be a repository someone else prepared.
- Claude's replies are untrusted input (prompt injection from file contents is possible). Claude gets **no tools** from Mochi; it can only propose whole-file edits that the user approves as a diff.
- A compromised webview (XSS) is assumed possible and must not be able to read/write arbitrary files, run programs or reach the network.

## Findings and fixes

| ID | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| F1 | High | `csp` was `null`: no Content Security Policy. Any injected script could run and call the network. | Strict CSP: own scripts only (no inline, no eval), no remote images/fonts/frames/connections, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`, `frame-ancestors 'none'`. A separate `devCsp` allows only the local dev server. | `src/securityConfig.test.ts`; live check |
| F2 | Medium | Capability granted `core:default` and `opener:default`; the opener plugin was loaded but never used. Unneeded attack surface. | Removed the opener plugin entirely. Capability reduced to `core:event:allow-listen`, `core:event:allow-unlisten`, `dialog:allow-open`. No fs/shell/http/updater plugins exist. | `securityConfig.test.ts`; live ACL check |
| F3 | Medium | Mochi ran `git` inside the chosen folder with that repo's own configuration, so a repo prepared by someone else could run code through hooks (`pre-commit`) or `core.fsmonitor`, or hang on a signing prompt. | Every git call now sets `core.hooksPath` to a non-existent folder, `core.fsmonitor=false`, `commit.gpgsign=false`, `tag.gpgsign=false` and `GIT_TERMINAL_PROMPT=0`. | `repo_hooks_do_not_run_when_mochi_commits` (with a control proving the hook fires under plain git), `commit_signing_config_cannot_block_mochi` |
| F4 | Medium | `set_config` accepted any `opsMemoryPath` and any `claudeProvider` string from the UI. A compromised UI could point Mochi's file commands at an arbitrary folder. | A changed path must be an existing folder that passes the wizard checks (not a root, system folder, or the home folder/its parents); unknown providers are dropped. | `saved_paths_must_exist_and_pass_the_wizard_checks`, `sanitized_drops_unknown_claude_providers` |
| F5 | Medium | Markdown links in notes would navigate the app's own webview away from Mochi, and remote images would fetch (leaking the user's IP). | Links render as inert text with the address as a tooltip; images render as `[image: alt]`; CSP `img-src` also blocks remote images. | `Browse.test.tsx` (links/images), live check |
| F6 | Medium | The Ops Memory path is written into `~/.claude/CLAUDE.md`, which Claude treats as instructions; a path containing line breaks could inject extra instructions. | The installer rejects empty paths and paths with control characters. | `ops_paths_with_control_characters_cannot_inject_instructions_into_claude_md` |
| F7 | Low | The installer could copy the build placeholder (a text file) as the hook helper. | `looks_like_real_binary` size check before installing. | `placeholders_and_missing_files_are_not_accepted_as_the_hook_helper` |
| F8 | Low | Bundle identifier ended in `.app` (conflicts with the macOS bundle extension). | Now `com.mochi.desktop`. | `securityConfig.test.ts` |

No open High or Medium findings.

## Live verification of the production build
The release binary was started with WebView2 remote debugging and inspected over the DevTools protocol (scripted, then the app was closed and its data deleted). Results:
- The wizard renders; `get_config` over IPC works; the page is a `main` landmark.
- Blocked by CSP: injected inline script, `eval` and `new Function` (checked with the DevTools CSP-eval bypass disabled), `fetch('https://…')`, remote image, remote iframe.
- ACL denied: `plugin:opener|open_url`, `plugin:fs|read_text_file`, `plugin:shell|execute`, `plugin:http|fetch`, `plugin:app|version`, `plugin:window|close`.
- The only console errors were the ones the probes caused deliberately.

## Reviewed and found acceptable
- **Path safety** (`store::resolve_path`): rejects absolute/drive/UNC paths, `..`, `.git`, NUL, and any path whose deepest existing ancestor resolves (symlinks) outside the root; listing skips symlinks; writes only `.md`; 1 MB limit. File commands take the root from saved config, never from the UI.
- **IPC surface** (all `#[tauri::command]`s): file commands are root-confined and secret-scanned; `claude_send` validates the request id; `setup_ops_memory`/`validate_ops_directory` apply the wizard folder rules; `integration_*` only touch `~/.claude` after the UI's diff + consent step and back files up; `set_launch_at_login` only runs on an explicit toggle.
- **Process spawning**: only `git` (fixed argument lists, `--` before user paths, commit subject always prefixed `mochi: `) and the `claude` CLI (fixed flags; model name restricted to `[A-Za-z0-9._-]`, not starting with `-`; the prompt goes through stdin, never the command line; found by searching `PATH` for `claude.exe`/`claude.cmd`). No shell is used anywhere. Because arguments are fixed and the model name is restricted, the Windows `.cmd` argument-injection class does not apply.
- **Secrets**: the API key lives only in the OS keychain, is read only inside Rust, never returned to the UI, logged, or put in config, and is cleared from the input after saving. API error messages never include the key (tested). The secret scanner runs on every write, on Claude's proposed edits, and on any text sent to Claude (flagged files are withheld). The hook helper outputs only keyword names, never command text. `config.json` holds no secrets.
- **Claude Code integration**: managed block + hooks are identified by the `mochi-hook` command, merged (never overwritten), backed up, uninstallable; an invalid `settings.json` is never touched; hooks fail open and block at most once per turn.
- **Supply chain**: `npm audit` reports 0 vulnerabilities. `cargo audit` is not installed on the development machine, so it was **not run**; it is part of CI (`.github/workflows/ci.yml`).

## Residual risks (accepted, documented)
- `style-src 'unsafe-inline'` is needed for React `style` attributes and Tailwind; scripts remain locked down.
- Sending Ops Memory content to Anthropic (chat/digest) is the product's purpose; files the scanner flags are withheld, but the scanner is heuristic and cannot catch every secret.
- Claude Code mode uses the user's own environment; an `ANTHROPIC_API_KEY` in the environment would be used by the CLI.
- macOS transparency needs the private API (no Mac App Store distribution).
- WebView2 remote debugging is only enabled by an environment variable; anyone who can set the user's environment already has local code execution.
- Installers are unsigned until signing certificates are configured (see `docs/release.md`); unsigned installers trigger OS warnings.
