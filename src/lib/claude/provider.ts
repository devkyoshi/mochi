import * as api from "../api";
import type { ChatMessage, ClaudeProviderKind, StreamEvent } from "../api";

export interface SendRequest {
  system: string;
  messages: ChatMessage[];
}

/** One way of talking to Claude. Both implementations stream through the same backend command. */
export interface ClaudeProvider {
  readonly kind: ClaudeProviderKind;
  /** Stream a reply; `onEvent` receives text deltas, then `done` or `error`. Resolves when finished. */
  send(request: SendRequest, onEvent: (e: StreamEvent) => void, signal?: AbortSignal): Promise<void>;
  /** Tiny request to check that the provider works. Resolves to the reply, rejects with a readable message. */
  test(): Promise<string>;
}

function newRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function make(kind: ClaudeProviderKind): ClaudeProvider {
  return {
    kind,
    async send(request, onEvent, signal) {
      const id = newRequestId();
      let finished = false;
      const deliver = (e: StreamEvent) => {
        if (finished) return;
        if (e.type !== "text") finished = true;
        onEvent(e);
      };
      const unlisten = await api.onClaudeStream(id, deliver);
      const onAbort = () => void api.claudeCancel(id).catch(() => undefined);
      signal?.addEventListener("abort", onAbort);
      try {
        await api.claudeSend(id, request.system, request.messages);
        // The backend always ends a stream with done/error; make sure the caller sees an ending.
        deliver({ type: "done" });
      } catch (e) {
        deliver({ type: "error", message: String(e) });
      } finally {
        signal?.removeEventListener("abort", onAbort);
        unlisten();
      }
    },
    test: () => api.claudeTest(kind),
  };
}

/** The two providers: the user's Claude Code CLI, or an Anthropic API key. */
export const createProvider = (kind: ClaudeProviderKind): ClaudeProvider => make(kind);
