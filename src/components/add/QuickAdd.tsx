import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../../lib/api";
import {
  NAME_RE,
  QUICK_TAGS,
  QuickAddError,
  planQuickAdd,
  todayIso,
  type EntryKind,
  type OpsEntry,
  type QuickTag,
} from "../../lib/opsMemory";
import { describeFindings, type SecretFinding } from "../../lib/secretScanner";
import { Mascot } from "../mascot";

interface QuickAddProps {
  files: { path: string; content: string }[];
  entries: OpsEntry[];
  /** Called after a note was saved (so the data can reload). */
  onSaved: () => void;
  /** Injected for tests. */
  today?: string;
}

type TargetKind = EntryKind | "inbox";

export const HAPPY_MS = 2000;

const field = "rounded-lg bg-white/10 px-2 py-1 text-sm text-white placeholder:text-neutral-500";

export function QuickAdd({ files, entries, onSaved, today }: QuickAddProps) {
  const [kind, setKind] = useState<TargetKind>("vm");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [tag, setTag] = useState<QuickTag | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [happy, setHappy] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const names = useMemo(
    () => (kind === "inbox" ? [] : entries.filter((e) => e.kind === kind).map((e) => e.name)),
    [entries, kind],
  );
  const trimmed = name.trim();
  const creating = kind !== "inbox" && trimmed !== "" && !names.includes(trimmed);
  const nameInvalid = kind !== "inbox" && trimmed !== "" && !NAME_RE.test(trimmed);
  const canSave = !saving && note.trim() !== "" && (kind === "inbox" || (trimmed !== "" && !nameInvalid));

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setBlocked([]);
    try {
      const plan = planQuickAdd({
        target: kind === "inbox" ? null : { kind, name: trimmed },
        note,
        tag: tag || undefined,
        today: today ?? todayIso(),
        files,
      });
      const outcome = await api.writeOpsFiles(plan.edits, plan.message);
      if (outcome.status === "blocked") {
        setBlocked(describeFindings(outcome.findings as SecretFinding[]));
        return;
      }
      setNote("");
      setHappy(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setHappy(false), HAPPY_MS);
      onSaved();
      noteRef.current?.focus();
    } catch (e) {
      setError(e instanceof QuickAddError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex h-full gap-4"
      data-testid="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex w-20 shrink-0 items-start justify-center pt-2">
        <Mascot state={saving ? "thinking" : happy ? "happy" : "idle"} size={64} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-neutral-400">
            For
            <select aria-label="Target type" value={kind} onChange={(e) => setKind(e.target.value as TargetKind)} className={field}>
              <option value="vm">VM</option>
              <option value="project">Project</option>
              <option value="inbox">Nothing yet (inbox)</option>
            </select>
          </label>
          {kind !== "inbox" && (
            <>
              <input
                aria-label="Name"
                list="quick-add-names"
                placeholder={kind === "vm" ? "e.g. prod-api-01" : "e.g. nexus-ai"}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${field} w-44`}
              />
              <datalist id="quick-add-names">
                {names.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </>
          )}
          <label className="flex items-center gap-1 text-neutral-400">
            Tag
            <select aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value as QuickTag | "")} className={field}>
              <option value="">none</option>
              {QUICK_TAGS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        {creating && !nameInvalid && (
          <p className="text-xs text-sky-300" data-testid="creating">
            Will create {kind === "vm" ? "vms" : "projects"}/{trimmed}.md from the template.
          </p>
        )}
        {nameInvalid && (
          <p role="alert" className="text-xs text-amber-300">
            Names may only contain letters, digits, ".", "_" and "-".
          </p>
        )}
        <textarea
          ref={noteRef}
          aria-label="Note"
          autoFocus
          rows={3}
          placeholder="What changed? e.g. Upgraded nginx to 1.27 (Ctrl+Enter to save)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void save();
            }
          }}
          className={`${field} min-h-0 flex-1 resize-none`}
        />
        {blocked.length > 0 && (
          <div role="alert" className="rounded-lg bg-amber-500/15 p-2 text-xs text-amber-200">
            <p className="font-medium">Not saved: this looks like it contains secrets. Store names and locations only.</p>
            <ul className="list-disc pl-5">
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
        <div className="flex items-center justify-end">
          <button
            type="submit"
            disabled={!canSave}
            className="rounded-full bg-sky-500 px-4 py-1.5 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40"
          >
            {kind === "inbox" ? "Add to inbox" : "Log change"}
          </button>
        </div>
      </div>
    </form>
  );
}
