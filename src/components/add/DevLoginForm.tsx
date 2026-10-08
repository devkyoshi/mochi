import { useMemo, useState } from "react";
import * as api from "../../lib/api";
import { QuickAddError, buildDirectory, parseLogins, planDevLogin, todayIso, type DevLogin } from "../../lib/opsMemory";
import { describeFindings, type SecretFinding } from "../../lib/secretScanner";
import { Select } from "../ui/Select";

interface DevLoginFormProps {
  files: { path: string; content: string }[];
  onSaved: () => void;
  /** Mascot hooks owned by the parent. */
  onBusy: (busy: boolean) => void;
  onHappy: () => void;
  /** Injected for tests. */
  today?: string;
}

const NEW = "__new__";
const field = "rounded-lg bg-white/10 px-2 py-1 text-sm text-white placeholder:text-neutral-500";
const empty = { label: "", url: "", username: "", role: "", notes: "" };

/**
 * Add or update a dev login for a VM or project. The markdown gets the label, URL, username and role;
 * the password goes only to the OS keychain and is never written to a file.
 */
export function DevLoginForm({ files, onSaved, onBusy, onHappy, today }: DevLoginFormProps) {
  const [kind, setKind] = useState<"vm" | "project">("project");
  const [target, setTarget] = useState("");
  const [pick, setPick] = useState(NEW);
  const [form, setForm] = useState(empty);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);

  const dir = useMemo(() => buildDirectory(files), [files]);
  const names = (kind === "vm" ? dir.vms : dir.projects).map((e) => e.name);
  const entry = (kind === "vm" ? dir.vms : dir.projects).find((e) => e.name === target);
  const content = entry ? files.find((f) => f.path === entry.path)?.content : undefined;
  const logins = useMemo(() => (content ? parseLogins(content) : []), [content]);

  const loginKey = (l: Pick<DevLogin, "label" | "username">) => `${l.label}|${l.username}`;
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const canSave = !saving && target !== "" && form.label.trim() !== "" && form.username.trim() !== "";

  function chooseLogin(key: string) {
    setPick(key);
    setPassword("");
    const found = logins.find((l) => loginKey(l) === key);
    setForm(found ? { label: found.label, url: found.url, username: found.username, role: found.role, notes: found.notes } : empty);
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    onBusy(true);
    setError(null);
    setNotice(null);
    setBlocked([]);
    try {
      const plan = planDevLogin({
        target: { kind, name: target },
        login: form,
        newPassword: password !== "",
        today: today ?? todayIso(),
        files,
      });
      const outcome = await api.writeOpsFiles(plan.edits, plan.message);
      if (outcome.status === "blocked") {
        setBlocked(describeFindings(outcome.findings as SecretFinding[]));
        return;
      }
      if (password !== "") {
        try {
          await api.secretSet(plan.account, password);
        } catch (e) {
          setError(`The login details were saved, but the password could not be stored: ${String(e)}`);
          onSaved();
          return;
        }
      }
      setPassword("");
      setNotice(password !== "" ? "Saved. The password is in the OS keychain." : "Saved.");
      setPick(loginKey({ label: form.label.trim().replace(/\s+/g, " "), username: form.username.trim() }));
      onHappy();
      onSaved();
    } catch (e) {
      setError(e instanceof QuickAddError ? e.message : String(e));
    } finally {
      setSaving(false);
      onBusy(false);
    }
  }

  return (
    <form
      className="flex min-w-0 flex-1 flex-col gap-3 text-sm"
      data-testid="dev-login-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-36"
          label="Login for"
          value={kind}
          options={[
            { value: "project", label: "Project" },
            { value: "vm", label: "VM" },
          ]}
          onChange={(v) => {
            setKind(v as "vm" | "project");
            setTarget("");
            chooseLogin(NEW);
          }}
        />
        <Select
          className="w-56"
          label={kind === "vm" ? "Which VM" : "Which project"}
          value={target}
          placeholder={names.length === 0 ? `No ${kind === "vm" ? "VMs" : "projects"} yet` : `Choose a ${kind === "vm" ? "VM" : "project"}`}
          options={names.map((n) => ({ value: n, label: n }))}
          onChange={(v) => {
            setTarget(v);
            chooseLogin(NEW);
          }}
        />
        {target !== "" && (
          <Select
            className="w-64"
            label="Which login"
            value={pick}
            options={[{ value: NEW, label: "+ New login" }, ...logins.map((l) => ({ value: loginKey(l), label: l.label, hint: l.username }))]}
            onChange={chooseLogin}
          />
        )}
      </div>

      {target === "" ? (
        <p className="text-neutral-500">Choose where this login belongs. Names come from your vms/ and projects/ files.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <input aria-label="Label" placeholder="Label, e.g. Admin" value={form.label} onChange={(e) => set({ label: e.target.value })} className={field} />
          <input aria-label="Role" placeholder="Role, e.g. Designer" value={form.role} onChange={(e) => set({ role: e.target.value })} className={field} />
          <input aria-label="Login URL" placeholder="URL, e.g. http://1.2.3.4" value={form.url} onChange={(e) => set({ url: e.target.value })} className={`${field} sm:col-span-2`} />
          <input aria-label="Username" placeholder="Username or email" autoComplete="off" value={form.username} onChange={(e) => set({ username: e.target.value })} className={field} />
          <input
            aria-label="Password"
            type="password"
            autoComplete="new-password"
            placeholder={logins.find((l) => loginKey(l) === pick)?.hasPassword ? "Leave blank to keep the saved password" : "Password (stored in the OS keychain)"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
          <input aria-label="Notes" placeholder="Notes (optional)" value={form.notes} onChange={(e) => set({ notes: e.target.value })} className={`${field} sm:col-span-2`} />
          <p className="text-xs text-neutral-500 sm:col-span-2">Passwords never go into your markdown files or git history. Only the keychain holds them.</p>
        </div>
      )}

      {blocked.length > 0 && (
        <div role="alert" className="rounded-lg bg-amber-500/15 p-2 text-xs text-amber-200">
          <p className="font-medium">Not saved: this looks like it contains secrets. Keep passwords in the password field.</p>
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
      {notice && (
        <p role="status" className="text-emerald-300">
          {notice}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSave}
          className="rounded-full bg-sky-500 px-4 py-1.5 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40"
        >
          Save login
        </button>
      </div>
    </form>
  );
}
