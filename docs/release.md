# Building and releasing Mochi

## Local builds
```
npm ci
npm run tauri build            # installer(s) for the current OS, in src-tauri/target/release/bundle/
npm run tauri build -- --no-bundle   # just the executable (src-tauri/target/release/mochi.exe)
```
`beforeBuildCommand` runs `npm run prepare:hook:release`, which builds the `mochi-hook` helper (used by the Claude Code hooks) for the target being bundled and puts it where Tauri's `bundle.externalBin` expects it (`src-tauri/binaries/mochi-hook-<triple>`, git-ignored). Tauri then ships it next to the app executable, which is where the installer (`integration_install`) looks for it. `npm run tauri dev` does the same for debug builds. On a fresh checkout `cargo test` works without it (`build.rs` creates a clearly marked placeholder, which the installer refuses to use).

Needs: Rust (stable), Node 22+, git. Windows: MSVC build tools and WebView2 (preinstalled on Windows 11). Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev libssl-dev patchelf`. Installers can only be built on their own OS (the CI matrix does all three).

## CI and releases
- `.github/workflows/ci.yml`: typecheck, lint, vitest and `cargo test` on Ubuntu, Windows and macOS for every push/PR; `cargo audit` and `npm audit` in a separate job.
- `.github/workflows/release.yml`: pushing a tag `vX.Y.Z` builds Windows, macOS (Apple Silicon and Intel) and Linux installers and attaches them to a **draft** GitHub release for review.
- Both workflows were written but **could not be run from the development machine**; expect to fix small issues on first run.

## Code signing (needed before wide distribution)
Not configured yet; unsigned installers show SmartScreen / Gatekeeper warnings.
- Windows: an Authenticode certificate (set `bundle.windows.certificateThumbprint` or use a signing command in CI).
- macOS: Developer ID certificate + notarisation (`APPLE_CERTIFICATE`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` secrets read by tauri-action).
- Linux: none required; optionally sign the AppImage.

## Auto-update plan (not implemented)
1. Add `tauri-plugin-updater` and `tauri-plugin-process` (relaunch) and grant only `updater:default` / `process:allow-restart` to the main window.
2. Generate an updater key pair (`npm run tauri signer generate`); keep the private key and its password in CI secrets only; put the public key in `tauri.conf.json` (`plugins.updater.pubkey`).
3. Have `release.yml` publish `latest.json` plus the signed update bundles with the release (tauri-action does this when `TAURI_SIGNING_PRIVATE_KEY` is set), and point `plugins.updater.endpoints` at the release's `latest.json`.
4. Add `https://github.com` (the release host) to the CSP `connect-src` only if the check is done from the webview; prefer checking from Rust so the CSP stays closed.
5. UI: a quiet "Update available" row in Settings; never auto-restart while a Claude request or a save is running. Updates are verified with the public key before install.
6. Re-run the checklist in `docs/security-review.md` (capabilities, CSP, new IPC) when this lands.

## Version bump checklist
`package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` versions; update `docs/PROGRESS.md`; tag `vX.Y.Z`.

## Known limits
- Settings from builds made before Stage 11 live under the old identifier folder (`com.mochi.app`) and are not migrated; re-run the wizard once.
- The hook helper must be installed from the bundled app (or a dev build) before Claude Code hooks can reference it; its path is stored as an absolute path in `~/.claude/settings.json`, so moving the config folder requires "Update" in Settings.
