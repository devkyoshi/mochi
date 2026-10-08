import { useCallback, useEffect, useState } from "react";
import * as api from "../../lib/api";
import { hasChanges, lineDiff } from "../../lib/opsMemory";

interface GlobalRuleSetupProps {
  /** Ops Memory folder to put in the rule (the wizard passes it before it is saved). */
  opsPath?: string | null;
  /** Called whenever the installed state is known or changes (the wizard uses it to label its button). */
  onInstalledChange?: (installed: boolean) => void;
}

function DiffBox({ title, before, after }: { title: string; before: string | null; after: string }) {
  const diff = lineDiff(before ?? "", after);
  const changed = hasChanges(diff);
  return (
    <div>
      <p className="text-xs font-medium text-neutral-300">
        {title} {before === null && "(new file)"}
      </p>
      <div className="max-h-24 overflow-auto rounded bg-black/30 p-1 font-mono text-xs" aria-label={`Changes to ${title}`}>
        {changed ? (
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
}

const btn = "rounded-full px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40";

/**
 * Install, update or remove the Claude Code integration. Always shows a dry-run diff first and
 * needs explicit consent; existing files are backed up by the installer.
 */
export function GlobalRuleSetup({ opsPath, onInstalledChange }: GlobalRuleSetupProps) {
  const [status, setStatus] = useState<api.IntegrationStatus | null>(null);
  const [plan, setPlan] = useState<api.InstallPlan | null>(null);
  const [mode, setMode] = useState<"install" | "uninstall" | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.integrationStatus());
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  const installed = !!status && (status.ruleInstalled || status.stopHook || status.sessionEndHook);
  useEffect(() => {
    if (status) onInstalledChange?.(installed);
  }, [status, installed, onInstalledChange]);

  async function preview(next: "install" | "uninstall") {
    setError(null);
    setDone(null);
    setConsent(false);
    try {
      setPlan(await api.integrationPreview(next === "uninstall", opsPath ?? undefined));
      setMode(next);
    } catch (e) {
      setError(String(e));
    }
  }

  async function confirm() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      const result = mode === "install" ? await api.integrationInstall(opsPath ?? undefined) : await api.integrationUninstall();
      setStatus(result.status);
      setDone(
        (mode === "install" ? "Installed." : "Removed.") +
          (result.backups.length ? ` Backups saved next to your Claude files (${result.backups.length}).` : ""),
      );
      setPlan(null);
      setMode(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 text-sm" data-testid="global-rule">
      {status?.settingsError && (
        <p role="alert" className="text-amber-300">
          {status.settingsError}
        </p>
      )}
      {status && (
        <p className="text-neutral-400" data-testid="integration-status">
          {installed
            ? `Installed: rule ${status.ruleInstalled ? "yes" : "no"}, Stop hook ${status.stopHook ? "yes" : "no"}, SessionEnd hook ${status.sessionEndHook ? "yes" : "no"}`
            : "Not installed. Nothing on your machine has been changed."}
        </p>
      )}

      {!plan && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${btn} bg-white/10 text-white hover:bg-white/20`} onClick={() => void preview("install")}>
            {installed ? "Preview update" : "Preview changes"}
          </button>
          {installed && (
            <button type="button" className={`${btn} bg-white/10 text-white hover:bg-white/20`} onClick={() => void preview("uninstall")}>
              Preview removal
            </button>
          )}
        </div>
      )}

      {plan && (
        <div className="space-y-2" data-testid="rule-preview">
          {plan.unchanged ? (
            <p className="text-neutral-400">Everything is already up to date.</p>
          ) : (
            <>
              <DiffBox title="~/.claude/CLAUDE.md" before={plan.claudeMdBefore} after={plan.claudeMdAfter} />
              <DiffBox title="~/.claude/settings.json" before={plan.settingsBefore} after={plan.settingsAfter} />
              <p className="text-xs text-neutral-500">Your existing files are backed up first. Other settings and hooks are not touched.</p>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="accent-sky-400" />
                I agree to {mode === "install" ? "these changes" : "remove Mochi's entries"}
              </label>
            </>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={`${btn} text-neutral-400 hover:text-white`} onClick={() => { setPlan(null); setMode(null); }}>
              Cancel
            </button>
            {!plan.unchanged && (
              <button type="button" className={`${btn} bg-sky-500 text-white`} disabled={!consent || busy} onClick={() => void confirm()}>
                {mode === "install" ? (installed ? "Update" : "Install") : "Remove"}
              </button>
            )}
          </div>
        </div>
      )}

      {done && (
        <p role="status" className="text-emerald-300">
          {done}
        </p>
      )}
      {error && (
        <p role="alert" className="text-amber-300">
          {error}
        </p>
      )}
    </div>
  );
}
