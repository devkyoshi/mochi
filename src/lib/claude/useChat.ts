import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api";
import { todayIso } from "../opsMemory";
import { scanSecrets } from "../secretScanner";
import { describeFindings, type SecretFinding } from "../secretScanner";
import { buildContext, SYSTEM_PROMPT } from "./context";
import { createProvider, type ClaudeProvider } from "./provider";
import { parseReply, validateProposals, visibleText, type EditProposal } from "./proposals";

export type ProposalStatus = "pending" | "applied" | "rejected";

export interface ChatEntry {
  id: number;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  error?: string;
  proposals?: EditProposal[];
  proposalStatus?: ProposalStatus;
  /** Warnings about dropped edits or withheld files. */
  notes?: string[];
  /** Redacted findings if applying was blocked by the secret scanner. */
  blocked?: string[];
}

export interface UseChatOptions {
  files: { path: string; content: string }[];
  claudeProvider: api.ClaudeProviderKind | null;
  autoApply: boolean;
  /** Called after files were changed by an applied proposal. */
  onApplied: () => void;
  /** Injectable for tests. */
  createProvider?: (kind: api.ClaudeProviderKind) => ClaudeProvider;
  today?: string;
}

let nextId = 1;

export function useChat(opts: UseChatOptions) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const entriesRef = useRef<ChatEntry[]>([]);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const patch = useCallback((id: number, change: Partial<ChatEntry>) => {
    setEntries((list) => list.map((e) => (e.id === id ? { ...e, ...change } : e)));
  }, []);

  /** Write proposals through the scan -> commit pipeline as one commit. */
  const apply = useCallback(
    async (id: number): Promise<void> => {
      const entry = entriesRef.current.find((e) => e.id === id);
      if (!entry?.proposals?.length) return;
      try {
        const outcome = await api.writeOpsFiles(entry.proposals, "claude: apply proposed edits");
        if (outcome.status === "blocked") {
          patch(id, { blocked: describeFindings(outcome.findings as SecretFinding[]), proposalStatus: "pending" });
          return;
        }
        patch(id, { proposalStatus: "applied", blocked: undefined });
        optsRef.current.onApplied();
      } catch (e) {
        patch(id, { error: String(e) });
      }
    },
    [patch],
  );

  const reject = useCallback((id: number) => patch(id, { proposalStatus: "rejected" }), [patch]);

  const send = useCallback(
    async (text: string): Promise<void> => {
      const current = optsRef.current;
      const trimmed = text.trim();
      if (!trimmed || busy || !current.claudeProvider) return;

      const userId = nextId++;
      const botId = nextId++;
      const history: api.ChatMessage[] = [
        ...entriesRef.current.filter((e) => !e.error && e.text).map((e) => ({ role: e.role, content: e.text })),
        { role: "user", content: trimmed },
      ];
      setEntries((l) => [...l, { id: userId, role: "user", text: trimmed }, { id: botId, role: "assistant", text: "", streaming: true }]);
      setBusy(true);
      const controller = new AbortController();
      abort.current = controller;

      try {
        // Files that look like they hold secrets are never sent.
        const flagged = new Set<string>();
        for (const f of current.files) {
          if ((await scanSecrets(f.content)).length > 0) flagged.add(f.path);
        }
        const ctx = buildContext(current.files, flagged);
        const system = `${SYSTEM_PROMPT}\n\nToday is ${current.today ?? todayIso()}.\n\n${ctx.text}`;
        const notes: string[] = [];
        if (ctx.withheld.length) notes.push(`Not sent to Claude (looked like they contain secrets): ${ctx.withheld.join(", ")}`);
        if (ctx.truncated.length) notes.push(`Left out because of size: ${ctx.truncated.join(", ")}`);

        const provider = (current.createProvider ?? createProvider)(current.claudeProvider);
        let raw = "";
        let failure: string | undefined;
        await provider.send(
          { system, messages: history },
          (e) => {
            if (e.type === "text") {
              raw += e.text;
              patch(botId, { text: visibleText(raw) });
            } else if (e.type === "error") {
              failure = e.message;
            }
          },
          controller.signal,
        );

        if (failure) {
          patch(botId, { streaming: false, error: failure, text: visibleText(raw), notes });
          return;
        }
        const parsed = parseReply(raw);
        const checked = validateProposals(parsed.proposals);
        const dropped = [...parsed.rejected, ...checked.rejected].map((r) => `Ignored an edit to ${r.path}: ${r.reason}`);
        patch(botId, {
          streaming: false,
          text: parsed.text,
          proposals: checked.accepted.length ? checked.accepted : undefined,
          proposalStatus: checked.accepted.length ? "pending" : undefined,
          notes: [...notes, ...dropped],
        });
        if (checked.accepted.length && current.autoApply) {
          const outcome = await api.writeOpsFiles(checked.accepted, "claude: apply proposed edits");
          if (outcome.status === "blocked") {
            patch(botId, { blocked: describeFindings(outcome.findings as SecretFinding[]) });
          } else {
            patch(botId, { proposalStatus: "applied" });
            current.onApplied();
          }
        }
      } catch (e) {
        patch(botId, { streaming: false, error: String(e) });
      } finally {
        abort.current = null;
        setBusy(false);
      }
    },
    [busy, patch],
  );

  const stop = useCallback(() => abort.current?.abort(), []);
  const clear = useCallback(() => setEntries([]), []);

  return { entries, busy, send, stop, clear, apply, reject };
}
