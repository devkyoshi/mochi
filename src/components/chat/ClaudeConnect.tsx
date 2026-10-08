import { useState } from "react";
import * as api from "../../lib/api";
import type { ClaudeProviderKind } from "../../lib/api";
import { Mascot } from "../mascot";

interface ClaudeConnectProps {
  /** Currently connected provider, if any. */
  connected: ClaudeProviderKind | null;
  onConnected: (kind: ClaudeProviderKind) => void;
}

const OPTIONS: { kind: ClaudeProviderKind; label: string; hint: string }[] = [
  { kind: "cli", label: "Claude Code (uses my existing login)", hint: "Needs the claude command installed and signed in." },
  { kind: "api", label: "Anthropic API key", hint: "Stored in your operating system keychain, never in a file." },
];

/** Choose a provider, enter a key if needed, and run a test call. */
export function ClaudeConnect({ connected, onConnected }: ClaudeConnectProps) {
  const [kind, setKind] = useState<ClaudeProviderKind>(connected ?? "cli");
  const [key, setKey] = useState("");
  const [state, setState] = useState<"idle" | "testing" | "ok" | "error">(connected ? "ok" : "idle");
  const [message, setMessage] = useState<string | null>(null);

  async function test() {
    setState("testing");
    setMessage(null);
    try {
      if (kind === "api") {
        if (key.trim()) {
          await api.claudeSaveKey(key.trim());
          setKey(""); // the key lives in the keychain from now on
        } else if (!(await api.claudeHasKey())) {
          throw new Error("Paste your API key first.");
        }
      }
      await api.claudeTest(kind);
      setState("ok");
      onConnected(kind);
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-2 text-sm" data-testid="claude-connect">
      <div role="radiogroup" aria-label="Claude connection" className="space-y-1">
        {OPTIONS.map((o) => (
          <label key={o.kind} className="flex items-start gap-2">
            <input
              type="radio"
              name="claude-kind"
              checked={kind === o.kind}
              onChange={() => {
                setKind(o.kind);
                setState("idle");
                setMessage(null);
              }}
              className="mt-1 accent-sky-400"
            />
            <span>
              {o.label}
              <span className="block text-xs text-neutral-500">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {kind === "api" && (
        <input
          type="password"
          aria-label="API key"
          autoComplete="off"
          placeholder={connected === "api" ? "Key saved. Paste a new one to replace it" : "sk-ant-…"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="w-full rounded-lg bg-white/10 px-2 py-1 text-white placeholder:text-neutral-500"
        />
      )}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void test()}
          disabled={state === "testing"}
          className="rounded-full bg-white/10 px-3 py-1 text-white hover:bg-white/20 disabled:opacity-40"
        >
          {state === "testing" ? "Testing…" : "Test connection"}
        </button>
        {state === "ok" && (
          <span className="flex items-center gap-1 text-emerald-300" role="status">
            <Mascot state="happy" size={28} /> Connected
          </span>
        )}
      </div>
      {state === "error" && message && (
        <p role="alert" className="text-amber-300">
          {message}
        </p>
      )}
    </div>
  );
}
