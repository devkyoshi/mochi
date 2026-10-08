import { useEffect, useMemo, useRef, useState } from "react";
import type { ClaudeProviderKind } from "../../lib/api";
import { useChat, type ChatEntry } from "../../lib/claude/useChat";
import type { ClaudeProvider } from "../../lib/claude/provider";
import { hasChanges, lineDiff } from "../../lib/opsMemory";
import { Mascot } from "../mascot";

interface ChatProps {
  files: { path: string; content: string }[];
  claudeProvider: ClaudeProviderKind | null;
  autoApply: boolean;
  onApplied: () => void;
  onOpenSettings: () => void;
  /** Injectable for tests. */
  createProvider?: (kind: ClaudeProviderKind) => ClaudeProvider;
  today?: string;
}

function ProposalCard({
  entry,
  files,
  onApply,
  onReject,
}: {
  entry: ChatEntry;
  files: { path: string; content: string }[];
  onApply: () => void;
  onReject: () => void;
}) {
  const byPath = useMemo(() => new Map(files.map((f) => [f.path, f.content])), [files]);
  const status = entry.proposalStatus;
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-black/30 p-2" data-testid="proposals">
      {entry.proposals?.map((p) => {
        const diff = lineDiff(byPath.get(p.path) ?? "", p.content);
        return (
          <div key={p.path}>
            <p className="text-xs font-medium text-neutral-300">
              {p.path} {byPath.has(p.path) ? "" : "(new file)"}
            </p>
            <div className="max-h-32 overflow-auto font-mono text-xs" aria-label={`Changes to ${p.path}`}>
              {hasChanges(diff) ? (
                diff
                  .filter((d) => d.kind !== "same")
                  .map((d, i) => (
                    <div key={i} data-kind={d.kind} className={d.kind === "add" ? "bg-emerald-500/20 text-emerald-200" : "bg-rose-500/20 text-rose-200"}>
                      {d.kind === "add" ? "+ " : "- "}
                      {d.text}
                    </div>
                  ))
              ) : (
                <p className="text-neutral-500">No changes.</p>
              )}
            </div>
          </div>
        );
      })}
      {entry.blocked && (
        <div role="alert" className="rounded bg-amber-500/15 p-2 text-xs text-amber-200">
          <p className="font-medium">Not saved: this looks like it contains secrets.</p>
          <ul className="list-disc pl-5">
            {entry.blocked.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {status === "pending" && (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onReject} className="rounded-full px-3 py-1 text-xs text-neutral-400 hover:text-white">
            Reject
          </button>
          <button type="button" onClick={onApply} className="rounded-full bg-sky-500 px-3 py-1 text-xs text-white">
            Apply changes
          </button>
        </div>
      )}
      {status === "applied" && <p className="text-xs text-emerald-300">Applied and committed.</p>}
      {status === "rejected" && <p className="text-xs text-neutral-500">Rejected. Nothing was changed.</p>}
    </div>
  );
}

export function Chat({ files, claudeProvider, autoApply, onApplied, onOpenSettings, createProvider, today }: ChatProps) {
  const chat = useChat({ files, claudeProvider, autoApply, onApplied, createProvider, today });
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [chat.entries]);

  if (!claudeProvider) {
    return (
      <div className="space-y-2 text-sm" data-testid="chat-disconnected">
        <p>Claude is not connected yet.</p>
        <button type="button" onClick={onOpenSettings} className="rounded-full bg-white/10 px-3 py-1 text-white hover:bg-white/20">
          Open settings
        </button>
      </div>
    );
  }

  function submit() {
    const text = input;
    if (!text.trim() || chat.busy) return;
    setInput("");
    void chat.send(text);
  }

  return (
    <div className="flex h-full gap-3" data-testid="chat">
      <div className="flex w-16 shrink-0 justify-center pt-1">
        <Mascot state={chat.busy ? "thinking" : "idle"} size={56} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1" aria-live="polite" aria-label="Conversation">
          {chat.entries.length === 0 && (
            <p className="text-neutral-500">
              Ask about your servers, or say what changed, e.g. &ldquo;log that I upgraded nginx on prod-api-01 to 1.27&rdquo;.
            </p>
          )}
          {chat.entries.map((e) => (
            <div key={e.id} className={e.role === "user" ? "text-right" : ""} data-role={e.role}>
              <div className={`inline-block max-w-full whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-left ${e.role === "user" ? "bg-sky-500/30 text-white" : "bg-white/10 text-neutral-100"}`}>
                {e.text || (e.streaming ? "…" : "")}
              </div>
              {e.error && (
                <p role="alert" className="mt-1 text-amber-300">
                  {e.error}
                </p>
              )}
              {e.notes?.map((n) => (
                <p key={n} className="mt-1 text-xs text-neutral-500">
                  {n}
                </p>
              ))}
              {e.proposals && (
                <ProposalCard entry={e} files={files} onApply={() => void chat.apply(e.id)} onReject={() => chat.reject(e.id)} />
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form
          className="flex gap-2"
          onSubmit={(ev) => {
            ev.preventDefault();
            submit();
          }}
        >
          <input
            aria-label="Message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Claude…"
            className="min-w-0 flex-1 rounded-full bg-white/10 px-3 py-1.5 text-white placeholder:text-neutral-500"
          />
          {chat.busy ? (
            <button type="button" onClick={chat.stop} className="rounded-full bg-white/10 px-3 py-1.5 text-white">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="rounded-full bg-sky-500 px-4 py-1.5 text-white disabled:opacity-40">
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
