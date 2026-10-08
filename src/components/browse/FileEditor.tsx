import { useMemo, useState } from "react";
import * as api from "../../lib/api";
import { describeFindings, type SecretFinding } from "../../lib/secretScanner";
import {
  hasChanges,
  lineDiff,
  parseMarkdown,
  readFrontmatter,
  serializeMarkdown,
  setField,
} from "../../lib/opsMemory";

interface FileEditorProps {
  path: string;
  original: string;
  onSaved: () => void;
  onCancel: () => void;
}

type Phase = "edit" | "review";

const button = "rounded-full px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40";

/** Raw markdown editor with a frontmatter form, a diff review step, and secret-blocked saves. */
export function FileEditor({ path, original, onSaved, onCancel }: FileEditorProps) {
  const [draft, setDraft] = useState(original);
  const [phase, setPhase] = useState<Phase>("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);

  const scalars = useMemo(() => {
    try {
      return Object.entries(readFrontmatter(parseMarkdown(draft))).filter(
        ([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
      ) as [string, string | number | boolean][];
    } catch {
      return [];
    }
  }, [draft]);

  const diff = useMemo(() => lineDiff(original, draft), [original, draft]);
  const changed = hasChanges(diff);

  function editField(key: string, value: string) {
    try {
      setDraft(serializeMarkdown(setField(parseMarkdown(draft), key, value)));
    } catch (e) {
      setError(String(e));
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setBlocked([]);
    try {
      const name = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
      const outcome = await api.writeOpsFile(path, draft, `update ${name}`);
      if (outcome.status === "blocked") {
        setBlocked(describeFindings(outcome.findings as SecretFinding[]));
        setPhase("edit");
      } else {
        onSaved();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 text-sm" data-testid="file-editor">
      {phase === "edit" ? (
        <>
          {scalars.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Frontmatter">
              {scalars.map(([k, v]) => (
                <label key={k} className="flex items-center gap-1 text-xs text-neutral-400">
                  {k}
                  <input
                    value={String(v)}
                    onChange={(e) => editField(k, e.target.value)}
                    className="w-32 rounded bg-white/10 px-1.5 py-0.5 text-neutral-100"
                  />
                </label>
              ))}
            </div>
          )}
          <textarea
            aria-label="Markdown source"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded-lg bg-black/30 p-2 font-mono text-xs text-neutral-100"
          />
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-black/30 p-2 font-mono text-xs" aria-label="Changes">
          {diff.map((d, i) => (
            <div
              key={i}
              data-kind={d.kind}
              className={d.kind === "add" ? "bg-emerald-500/20 text-emerald-200" : d.kind === "remove" ? "bg-rose-500/20 text-rose-200" : "text-neutral-500"}
            >
              {d.kind === "add" ? "+ " : d.kind === "remove" ? "- " : "  "}
              {d.text}
            </div>
          ))}
        </div>
      )}

      {blocked.length > 0 && (
        <div role="alert" className="rounded-lg bg-amber-500/15 p-2 text-amber-200">
          <p className="font-medium">Not saved: this looks like it contains secrets. Store names and locations only.</p>
          <ul className="list-disc pl-5 text-xs">
            {blocked.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="text-amber-300">
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button type="button" className={`${button} text-neutral-400 hover:text-white`} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        {phase === "edit" ? (
          <button type="button" className={`${button} bg-sky-500 text-white`} disabled={!changed} onClick={() => setPhase("review")}>
            Review changes
          </button>
        ) : (
          <>
            <button type="button" className={`${button} bg-white/10 text-white`} onClick={() => setPhase("edit")} disabled={saving}>
              Back to editing
            </button>
            <button type="button" className={`${button} bg-sky-500 text-white`} onClick={() => void save()} disabled={saving}>
              Save
            </button>
          </>
        )}
      </div>
    </div>
  );
}
