import { describe, expect, it } from "vitest";
import { computeStats, recentChanges, todayIso } from "./stats";
import { buildSearchIndex, search } from "./search";
import { hasChanges, lineDiff } from "./lineDiff";
import type { OpsEntry } from "./types";

const entry = (name: string, kind: "vm" | "project", lastUpdated?: string): OpsEntry => ({
  kind,
  name,
  path: `${kind}s/${name}.md`,
  lastUpdated,
  deployedOn: [],
});

describe("computeStats", () => {
  const today = "2026-10-08";
  it("counts vms, projects, this week's changes and stale entries", () => {
    const s = computeStats(
      [
        entry("a", "vm", "2026-10-07"), // 1 day
        entry("b", "vm", "2026-10-02"), // 6 days -> this week
        entry("c", "vm", "2026-10-01"), // 7 days -> not this week
        entry("d", "vm", "2026-09-08"), // 30 days -> not stale
        entry("e", "project", "2026-09-07"), // 31 days -> stale
        entry("f", "project"), // undated -> stale
      ],
      today,
    );
    expect(s).toEqual({ vmCount: 4, projectCount: 2, changedThisWeek: 2, stale: ["e", "f"] });
  });
  it("honours a custom stale threshold", () => {
    expect(computeStats([entry("a", "vm", "2026-10-01")], today, 5).stale).toEqual(["a"]);
  });
  it("treats future dates as neither this week nor stale", () => {
    const s = computeStats([entry("a", "vm", "2027-01-01")], today);
    expect(s.changedThisWeek).toBe(0);
    expect(s.stale).toEqual([]);
  });
  it("treats malformed dates as stale", () => {
    expect(computeStats([entry("a", "vm", "yesterday")], today).stale).toEqual(["a"]);
  });
  it("handles an empty list", () => {
    expect(computeStats([], today)).toEqual({ vmCount: 0, projectCount: 0, changedThisWeek: 0, stale: [] });
  });
});

describe("recentChanges", () => {
  const oct = "# Changelog 2026-10\n\n- 2026-10-07 — Upgraded nginx (vm: a)\n- 2026-10-02 — Deployed app\n- <YYYY-MM-DD> — placeholder\n";
  const sep = "# Changelog 2026-09\n\n- 2026-09-30 — Old thing\r\n";
  it("returns newest first across months and ignores placeholders", () => {
    const out = recentChanges(
      [
        { path: "changelog/2026-09.md", content: sep },
        { path: "changelog/2026-10.md", content: oct },
        { path: "vms/a.md", content: "- 2030-01-01 — not a changelog" },
      ],
      10,
    );
    expect(out.map((c) => c.date)).toEqual(["2026-10-07", "2026-10-02", "2026-09-30"]);
    expect(out[0]).toEqual({ date: "2026-10-07", text: "Upgraded nginx (vm: a)", source: "changelog/2026-10.md" });
  });
  it("respects the limit", () => {
    expect(recentChanges([{ path: "changelog/2026-10.md", content: oct }], 1)).toHaveLength(1);
  });
  it("sorts by date even if a file is out of order", () => {
    const out = recentChanges([{ path: "changelog/2026-10.md", content: "- 2026-10-01 — a\n- 2026-10-05 — b\n" }]);
    expect(out.map((c) => c.text)).toEqual(["b", "a"]);
  });
  it("accepts a plain hyphen separator and rejects impossible dates", () => {
    const out = recentChanges([{ path: "changelog/2026-10.md", content: "- 2026-10-01 - ok\n- 2026-02-30 — bad\n" }]);
    expect(out.map((c) => c.text)).toEqual(["ok"]);
  });
});

describe("todayIso", () => {
  it("formats local dates with zero padding", () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(todayIso(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("search", () => {
  const docs = [
    { path: "vms/prod-api-01.md", content: "---\ntype: vm\n---\nRuns nginx and the billing API on Ubuntu" },
    { path: "vms/staging-01.md", content: "Staging box. Postgres database lives here." },
    { path: "projects/billing.md", content: "Billing service deployed on prod-api-01" },
  ];
  const index = buildSearchIndex(docs);

  it("finds by content with a snippet around the match", () => {
    const hits = search(index, docs, "postgres");
    expect(hits.map((h) => h.path)).toEqual(["vms/staging-01.md"]);
    expect(hits[0].snippet.toLowerCase()).toContain("postgres");
  });
  it("matches prefixes and the file name", () => {
    expect(search(index, docs, "stag").map((h) => h.path)).toContain("vms/staging-01.md");
    expect(search(index, docs, "prod-api")[0].path).toBe("vms/prod-api-01.md");
  });
  it("requires all terms", () => {
    expect(search(index, docs, "nginx postgres")).toEqual([]);
  });
  it("returns nothing for empty queries and respects the limit", () => {
    expect(search(index, docs, "   ")).toEqual([]);
    expect(search(index, docs, "billing", 1)).toHaveLength(1);
  });
  it("tolerates small typos", () => {
    expect(search(index, docs, "postgrse").map((h) => h.path)).toContain("vms/staging-01.md");
  });
});

describe("lineDiff", () => {
  it("reports adds, removes and unchanged lines", () => {
    const d = lineDiff("a\nb\nc\n", "a\nB\nc\nd\n");
    expect(d).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
    expect(hasChanges(d)).toBe(true);
  });
  it("is empty of changes for identical text", () => {
    expect(hasChanges(lineDiff("x\ny\n", "x\ny\n"))).toBe(false);
  });
  it("handles empty before (new file)", () => {
    expect(lineDiff("", "hi\n")).toEqual([{ kind: "add", text: "hi" }]);
  });
});
