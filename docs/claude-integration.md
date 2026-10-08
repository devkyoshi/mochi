# Claude integration

Code: `src-tauri/src/claude.rs` (providers, keychain), `src/lib/claude/` (provider interface, prompt, context, edit proposals, chat hook), `src/components/chat/`.

## Design
- Two providers behind one interface (`ClaudeProvider.send/test` in `src/lib/claude/provider.ts`), both streaming through the `claude_send` command as `claude://<id>` events:
  - **cli**: spawns the user's `claude` with fixed args, working directory = Ops Memory folder, prompt on **stdin** (never in arguments).
  - **api**: `POST https://api.anthropic.com/v1/messages` with `stream: true`, model `claude-sonnet-5-5`. The key is stored in the OS keychain (`keyring`, service `mochi`) and is only read inside Rust; it is never sent to the UI, logged, or put in config.
- **Claude gets no file tools from Mochi.** It only returns text. To change files it proposes whole-file edits in `<mochi-edit path="...">` blocks. The UI parses them, rejects unsafe paths (`checkProposalPath`) and invalid vm/project entries (`validateProposals`), shows a diff, and applies approved edits (or all of them when "auto-apply" is on) with `write_ops_files`: secret scan -> write -> one git commit. Rust re-validates every path.
- Context sent to Claude = system prompt (schema, no-secrets rule, inbox fallback, edit format) + today's date + Ops Memory files within a size budget. Files the secret scanner flags are never sent.
- CLI args (`cli_args`): `-p --output-format stream-json --verbose --include-partial-messages [--model <validated>]`. The prompt tells the CLI not to use tools.

## Docs lookup (2026-10-08, via the docs agent; the `claude` binary is not on PATH in the dev machine, so the CLI was not run)
- `-p/--print`, `--output-format stream-json` (needs `--verbose`), `--include-partial-messages` for token deltas; stream lines: `system/init`, `stream_event` with `content_block_delta`/`text_delta`, final `result` (`is_error`, `result`).
- Messages API: headers `x-api-key`, `anthropic-version: 2023-06-01`; SSE events `content_block_delta` (`text_delta`), `message_stop`, `error`; 401 `authentication_error`, 429 `rate_limit_error`.
- Not adopted because unverified: `--permission-mode`, `--permission-prompts`, `--bare`, a `claude-haiku-5-5` id.

## Verified vs not
- Verified by automated tests: argument building, stream parsing, SSE parsing, a fake CLI process, a local fake HTTP server (headers/body/streaming/errors), error mapping without key leakage, edit parsing/validation, diff approval, scan -> commit.
- **Not verified live** (needs the user's login/key): a real `claude` run, a real API call, the real OS keychain round-trip. Use the wizard's / Settings' "Test connection" to check; if the CLI rejects an argument the test shows its message.
