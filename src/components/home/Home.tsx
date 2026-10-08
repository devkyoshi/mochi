import { useMemo } from "react";
import type { OpsData } from "../../lib/ops/useOpsMemory";
import { computeStats, recentChanges, todayIso } from "../../lib/opsMemory";

interface HomeProps {
  data: OpsData;
  loading: boolean;
  error: string | null;
  externalChange: boolean;
  changedPaths: string[];
  /** Sessions that changed servers without updating Ops Memory (stubs in inbox.md). */
  reviewStubs?: number;
  /** Days without an update before a VM/project counts as stale. */
  staleDays?: number;
  onDismissChange: () => void;
  onOpenInbox?: () => void;
  /** Injected for tests. */
  today?: string;
  children?: React.ReactNode;
}

export function Home({ data, loading, error, externalChange, changedPaths, reviewStubs = 0, staleDays = 30, onDismissChange, onOpenInbox, today, children }: HomeProps) {
  const day = today ?? todayIso();
  const stats = useMemo(() => computeStats(data.entries, day, staleDays), [data.entries, day, staleDays]);
  const changes = useMemo(() => recentChanges(data.files, 5), [data.files]);

  if (error) {
    return (
      <p role="alert" className="text-amber-300">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-3 text-sm" data-testid="home">
      {reviewStubs > 0 && (
        <div role="alert" className="rounded-lg bg-amber-500/15 px-3 py-2 text-amber-200" data-testid="review-alert">
          {reviewStubs} {reviewStubs === 1 ? "session" : "sessions"} changed servers without updating Ops Memory.{" "}
          {onOpenInbox ? (
            <button type="button" onClick={onOpenInbox} className="underline focus-visible:outline-2 focus-visible:outline-sky-400">
              Open inbox
            </button>
          ) : (
            "See inbox.md."
          )}
        </div>
      )}
      {externalChange && (
        <div role="status" className="flex items-center justify-between rounded-lg bg-orange-500/15 px-3 py-2 text-orange-200">
          <span>
            {changedPaths.length === 1 ? "1 file was" : `${changedPaths.length} files were`} updated outside Mochi.
          </span>
          <button type="button" onClick={onDismissChange} className="underline focus-visible:outline-2 focus-visible:outline-sky-400">
            Dismiss
          </button>
        </div>
      )}

      <p className="text-base text-white" data-testid="summary">
        {stats.vmCount} {stats.vmCount === 1 ? "VM" : "VMs"} · {stats.projectCount}{" "}
        {stats.projectCount === 1 ? "project" : "projects"} · {stats.changedThisWeek} changed this week ·{" "}
        {stats.stale.length} stale
      </p>

      {stats.stale.length > 0 && (
        <p className="text-amber-300" data-testid="stale">
          Not updated in {staleDays}+ days: {stats.stale.join(", ")}
        </p>
      )}
      {data.invalid.length > 0 && (
        <p className="text-amber-300" data-testid="invalid">
          {data.invalid.length} file{data.invalid.length === 1 ? "" : "s"} could not be read: {data.invalid.map((i) => i.path).join(", ")}
        </p>
      )}

      <div>
        <h3 className="mb-1 text-xs uppercase tracking-wide text-neutral-500">Recent changes</h3>
        {changes.length === 0 ? (
          <p className="text-neutral-500">{loading ? "Loading…" : "No changes logged yet."}</p>
        ) : (
          <ul className="space-y-0.5">
            {changes.map((c, i) => (
              <li key={`${c.date}-${i}`} className="truncate">
                <span className="text-neutral-500">{c.date}</span> {c.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      {children}
    </div>
  );
}
