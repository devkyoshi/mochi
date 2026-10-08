import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../../lib/api";
import { NAME_RE, QUICK_TAGS, QuickAddError, buildDirectory, planQuickAdd, todayIso, type QuickTag } from "../../lib/opsMemory";
import { describeFindings, type SecretFinding } from "../../lib/secretScanner";
import { Mascot } from "../mascot";
import { Select } from "../ui/Select";
import { DevLoginForm } from "./DevLoginForm";

interface QuickAddProps {
  files: { path: string; content: string }[];
  /** Called after something was saved (so the data can reload). */
  onSaved: () => void;
  /** Injected for tests. */
  today?: string;
}

type TargetKind = "vm" | "project" | "inbox";
type Mode = "note" | "login";

export const HAPPY_MS = 2000;
const NEW = "__new__";

const field = "rounded-lg bg-white/10 px-2 py-1 text-sm text-white placeholder:text-neutral-500";

const modeButton = (active: boolean) =>
  `rounded-full px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-sky-400 ${active ? "bg-white/15 text-white" : "text-neutral-400 hover:text-white"}`;

export function QuickAdd({ files, onSaved, today }: QuickAddProps) {
  const [mode, setMode] = useState<Mode>("note");
  const [kind, setKind] = useState<TargetKind>("vm");
  const [name, setName] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);
  const [note, setNote] = useState("");
  const [tag, setTag] = useState<QuickTag | "">("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [happy, setHappy] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function celebrate() {
    setHappy(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setHappy(false), HAPPY_MS);
  }

  const dir = useMemo(() => buildDirectory(files), [files]);
  const names = useMemo(() => (kind === "inbox" ? [] : (kind === "vm" ? dir.vms : dir.projects).map((e) => e.name)), [dir, kind]);
  const trimmed = name.trim();
  const creating = kind !== "inbox" && trimmed !== "" && !names.includes(trimmed);
  const nameInvalid = kind !== "inbox" && trimmed !== "" && !NAME_RE.test(trimmed);
  const canSave = !saving && note.trim() !== "" && (kind === "inbox" || (trimmed !== "" && !nameInvalid));
  const showNameInput = creatingNew || names.length === 0;

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
      celebrate();
      onSaved();
      noteRef.current?.focus();
    } catch (e) {
      setError(e instanceof QuickAddError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const mascotState = saving ? "thinking" : happy ? "happy" : "idle";

  return (
    <div className="flex h-full gap-4" data-testid="quick-add">
      <div className="flex w-20 shrink-0 items-start justify-center pt-2">
        <Mascot state={mascotState} size={64} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex gap-1" role="group" aria-label="What to add">
          <button type="button" aria-pressed={mode === "note"} className={modeButton(mode === "note")} onClick={() => setMode("note")}>
            Note
          </button>
          <button type="button" aria-pressed={mode === "login"} className={modeButton(mode === "login")} onClick={() => setMode("login")}>
            Dev login
          </button>
        </div>

        {mode === "login" ? (
          <DevLoginForm files={files} onSaved={onSaved} onBusy={setSaving} onHappy={celebrate} today={today} />
        ) : (
          <form
            className="flex min-h-0 flex-1 flex-col gap-2 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Select
                className="w-48"
                label="Target type"
                value={kind}
                options={[
                  { value: "vm", label: "VM" },
                  { value: "project", label: "Project" },
                  { value: "inbox", label: "Nothing yet (inbox)" },
                ]}
                onChange={(v) => {
                  setKind(v as TargetKind);
                  setName("");
                  setCreatingNew(false);
                }}
              />
              {kind !== "inbox" && names.length > 0 && (
                <Select
                  className="w-56"
                  label="Name"
                  value={creatingNew ? NEW : names.includes(trimmed) ? trimmed : ""}
                  placeholder={kind === "vm" ? "Choose a VM" : "Choose a project"}
                  options={[...names.map((n) => ({ value: n, label: n })), { value: NEW, label: `+ New ${kind === "vm" ? "VM" : "project"}…` }]}
                  onChange={(v) => {
                    setCreatingNew(v === NEW);
                    setName(v === NEW ? "" : v);
                  }}
                />
              )}
              {kind !== "inbox" && showNameInput && (
                <input
                  aria-label="New name"
                  placeholder={kind === "vm" ? "e.g. prod-api-01" : "e.g. nexus-ai"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`${field} w-44`}
                />
              )}
              <Select
                className="w-36"
                label="Tag"
                value={tag}
                options={[{ value: "", label: "No tag" }, ...QUICK_TAGS.map((t) => ({ value: t, label: t }))]}
                onChange={(v) => setTag(v as QuickTag | "")}
              />
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
          </form>
        )}
      </div>
    </div>
  );
}
