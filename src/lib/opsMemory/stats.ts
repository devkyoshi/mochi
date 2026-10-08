import type { OpsEntry } from "./types";
import { isIsoDate } from "./entries";

const DAY_MS = 86_400_000;

export interface OpsStats {
  vmCount: number;
  projectCount: number;
  /** Entries whose `last_updated` is within the last 7 days. */
  changedThisWeek: number;
  /** Names of VMs/projects not updated for more than `staleDays` (or never dated). */
  stale: string[];
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Compute the Home tab numbers. `today` is a YYYY-MM-DD string (injected so this stays testable). */
export function computeStats(entries: OpsEntry[], today: string, staleDays = 30): OpsStats {
  let changedThisWeek = 0;
  const stale: string[] = [];
  for (const e of entries) {
    if (!e.lastUpdated || !isIsoDate(e.lastUpdated)) {
      stale.push(e.name);
      continue;
    }
    const age = daysBetween(e.lastUpdated, today);
    if (age >= 0 && age < 7) changedThisWeek++;
    if (age > staleDays) stale.push(e.name);
  }
  return {
    vmCount: entries.filter((e) => e.kind === "vm").length,
    projectCount: entries.filter((e) => e.kind === "project").length,
    changedThisWeek,
    stale: stale.sort(),
  };
}

export interface ChangeLine {
  date: string;
  text: string;
  /** Changelog file the line came from. */
  source: string;
}

const CHANGE_RE = /^- (\d{4}-\d{2}-\d{2}) [—-] (.+)$/;

/**
 * Parse the newest `limit` change lines from changelog files (`changelog/YYYY-MM.md`).
 * Files are visited newest month first; within a file, order is preserved (newest first by convention).
 * Template placeholders such as `<YYYY-MM-DD>` are ignored.
 */
export function recentChanges(files: { path: string; content: string }[], limit = 5): ChangeLine[] {
  const changelogs = files
    .filter((f) => /^changelog\/\d{4}-\d{2}\.md$/.test(f.path))
    .sort((a, b) => (a.path < b.path ? 1 : -1));
  const out: ChangeLine[] = [];
  for (const f of changelogs) {
    for (const line of f.content.split(/\r?\n/)) {
      const m = CHANGE_RE.exec(line.trim());
      if (m && isIsoDate(m[1])) out.push({ date: m[1], text: m[2], source: f.path });
    }
  }
  // Stable sort: newest date first, ties keep file order.
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.date < b.c.date ? 1 : a.c.date > b.c.date ? -1 : a.i - b.i))
    .slice(0, limit)
    .map(({ c }) => c);
}

/** Today's date in local time as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
