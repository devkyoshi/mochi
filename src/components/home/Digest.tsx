import { useState } from "react";
import type { ClaudeProviderKind } from "../../lib/api";
import { buildDigestRequest, weekChanges } from "../../lib/claude/digest";
import { createProvider as defaultCreateProvider, type ClaudeProvider } from "../../lib/claude/provider";
import { parseReply } from "../../lib/claude/proposals";
import { todayIso } from "../../lib/opsMemory";
import { scanSecrets } from "../../lib/secretScanner";

interface DigestProps {
  files: { path: string; content: string }[];
  claudeProvider: ClaudeProviderKind | null;
  /** Injectable for tests. */
  createProvider?: (kind: ClaudeProviderKind) => ClaudeProvider;
  today?: string;
}

/** Weekly digest: Claude summarises the last 7 days of changelog lines. Read-only; never edits files. */
export function Digest({ files, claudeProvider, createProvider = defaultCreateProvider, today }: DigestProps) {
  const [state, setState] = useState<"idle" | "working" | "done">("idle");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!claudeProvider) return;
    setError(null);
    setText("");
    const day = today ?? todayIso();
    const request = buildDigestRequest(weekChanges(files, day), day);
    if (!request) {
      setText("No changes were logged in the past 7 days.");
      setState("done");
      return;
    }
    setState("working");
    try {
      const payload = request.messages.map((m) => m.content).join("\n");
      if ((await scanSecrets(payload)).length > 0) {
        throw new Error("The changelog looks like it contains a secret, so nothing was sent to Claude.");
      }
      let raw = "";
      let failure: string | undefined;
      await createProvider(claudeProvider).send(request, (e) => {
        if (e.type === "text") raw += e.text;
        else if (e.type === "error") failure = e.message;
      });
      if (failure) throw new Error(failure);
      setText(parseReply(raw).text || "Claude returned an empty digest.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setState("done");
    }
  }

  return (
    <section aria-label="Weekly digest" className="space-y-2" data-testid="digest">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void generate()}
          disabled={!claudeProvider || state === "working"}
          className="rounded-full bg-white/10 px-3 py-1 text-white hover:bg-white/20 disabled:opacity-40"
        >
          {state === "working" ? "Writing…" : "Weekly digest"}
        </button>
        {!claudeProvider && <span className="text-xs text-neutral-500">Connect Claude in Settings to use this.</span>}
      </div>
      {text && (
        <pre className="whitespace-pre-wrap rounded-lg bg-black/30 p-2 font-sans text-sm text-neutral-200" aria-live="polite">
          {text}
        </pre>
      )}
      {error && (
        <p role="alert" className="text-amber-300">
          {error}
        </p>
      )}
    </section>
  );
}
