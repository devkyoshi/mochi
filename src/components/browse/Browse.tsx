import { useMemo, useState } from "react";
import * as api from "../../lib/api";
import type { OpsData } from "../../lib/ops/useOpsMemory";
import type { SearchHit } from "../../lib/opsMemory";
import { FileEditor } from "./FileEditor";
import { MarkdownView } from "./MarkdownView";

interface BrowseProps {
  data: OpsData;
  runSearch: (q: string) => SearchHit[];
  reload: () => Promise<void>;
  /** Called after Mochi itself changed files (save or undo). */
  onMutated?: () => void;
}

interface Row {
  path: string;
  label: string;
  hint?: string;
}

const group = (p: string) => (p.startsWith("vms/") ? "VMs" : p.startsWith("projects/") ? "Projects" : "Other");

export function Browse({ data, runSearch, reload, onMutated }: BrowseProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const hits = useMemo(() => runSearch(query), [runSearch, query]);
  const lastUpdated = useMemo(() => new Map(data.entries.map((e) => [e.path, e.lastUpdated])), [data.entries]);

  const rows: Row[] = query.trim()
    ? hits.map((h) => ({ path: h.path, label: h.path, hint: h.snippet }))
    : data.files.map((f) => ({ path: f.path, label: f.path.replace(/^(vms|projects)\//, ""), hint: lastUpdated.get(f.path) }));

  const current = data.files.find((f) => f.path === selected);

  async function undo() {
    setNotice(null);
    try {
      await api.undoLastChange();
      await reload();
      onMutated?.();
      setNotice("Last change undone.");
    } catch (e) {
      setNotice(String(e));
    }
  }

  const groups = query.trim() ? [["Results", rows] as const] : (["VMs", "Projects", "Other"] as const).map((g) => [g, rows.filter((r) => group(r.path) === g)] as const);

  return (
    <div className="flex h-full min-h-0 gap-3" data-testid="browse">
      <nav aria-label="Files" className="flex w-52 shrink-0 flex-col gap-2">
        <input
          type="search"
          aria-label="Search notes"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded-full bg-white/10 px-3 py-1 text-sm text-white placeholder:text-neutral-500"
        />
        <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
          {groups.map(([name, list]) =>
            list.length === 0 ? null : (
              <div key={name}>
                <h3 className="px-1 text-xs uppercase tracking-wide text-neutral-500">{name}</h3>
                <ul>
                  {list.map((r) => (
                    <li key={r.path}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(r.path);
                          setEditing(false);
                        }}
                        aria-current={selected === r.path}
                        className={`w-full rounded-lg px-2 py-1 text-left text-sm hover:bg-white/10 ${selected === r.path ? "bg-white/15 text-white" : "text-neutral-300"}`}
                      >
                        <span className="block truncate">{r.label}</span>
                        {r.hint && <span className="block truncate text-xs text-neutral-500">{r.hint}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          )}
          {query.trim() && rows.length === 0 && <p className="px-1 text-sm text-neutral-500">No matches.</p>}
        </div>
        <button
          type="button"
          onClick={() => void undo()}
          className="rounded-full bg-white/10 px-3 py-1 text-xs text-neutral-200 hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          Undo last change
        </button>
        {notice && (
          <p role="status" className="text-xs text-neutral-400">
            {notice}
          </p>
        )}
      </nav>

      <section className="min-w-0 flex-1 overflow-auto" aria-label="File">
        {!current ? (
          <p className="text-neutral-500">Pick a file on the left.</p>
        ) : editing ? (
          <FileEditor
            key={current.path}
            path={current.path}
            original={current.content}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              onMutated?.();
              void reload();
            }}
          />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="truncate text-sm font-medium text-white">{current.path}</h2>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-full bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-sky-400"
              >
                Edit
              </button>
            </div>
            <MarkdownView content={current.content} />
          </div>
        )}
      </section>
    </div>
  );
}
