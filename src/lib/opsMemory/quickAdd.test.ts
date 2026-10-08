import { describe, expect, it } from "vitest";
import { addChangelogLine, addInboxLine, addRecentChange, cleanNote, planQuickAdd, QuickAddError } from "./quickAdd";
import { parseEntry } from "./entries";
import { parseMarkdown, readFrontmatter } from "./frontmatter";

const TODAY = "2026-10-08";
const VM = `---
type: vm
name: prod-api-01
provider: DigitalOcean
last_updated: 2026-09-01
updated_by: claude-code
---

## Purpose
API box.

## Recent Changes
- 2026-09-01 — Older change (by: claude-code)

## Open Issues / TODO
- [ ] nothing
`;
const CHANGELOG = "# Changelog 2026-10\n\nNewest first. One line per change. No secret values.\n\n- 2026-10-02 — Earlier (vm: a, by: claude-code)\n";

const files = (extra: { path: string; content: string }[] = []) => [
  { path: "vms/prod-api-01.md", content: VM },
  { path: "inbox.md", content: "# Inbox\n\nstub\n" },
  ...extra,
];
const get = (plan: ReturnType<typeof planQuickAdd>, path: string) => plan.edits.find((e) => e.path === path)?.content;

describe("cleanNote", () => {
  it("collapses whitespace and newlines", () => {
    expect(cleanNote("  upgraded\n nginx \t to 1.27 ")).toBe("upgraded nginx to 1.27");
  });
});

describe("addRecentChange", () => {
  it("inserts right under the heading and keeps the rest", () => {
    const out = addRecentChange("## Recent Changes\n- old\n\n## Next\nx\n", "- new");
    expect(out).toBe("## Recent Changes\n- new\n- old\n\n## Next\nx\n");
  });
  it("replaces the template placeholder bullet", () => {
    const out = addRecentChange("## Recent Changes\n- <YYYY-MM-DD> — <what>\n\n## Open\n", "- new");
    expect(out).toBe("## Recent Changes\n- new\n\n## Open\n");
  });
  it("works for an empty section followed by another heading", () => {
    expect(addRecentChange("## Recent Changes\n\n## Known Issues\n", "- new")).toBe("## Recent Changes\n- new\n\n## Known Issues\n");
  });
  it("creates the section when missing and handles an empty body", () => {
    expect(addRecentChange("## Purpose\nx\n", "- new")).toBe("## Purpose\nx\n\n## Recent Changes\n- new\n");
    expect(addRecentChange("", "- new")).toBe("## Recent Changes\n- new\n");
  });
  it("keeps CRLF files CRLF", () => {
    const out = addRecentChange("## Recent Changes\r\n- old\r\n", "- new");
    expect(out).toBe("## Recent Changes\r\n- new\r\n- old\r\n");
  });
});

describe("addChangelogLine", () => {
  it("prepends above the newest entry", () => {
    const out = addChangelogLine(CHANGELOG, "2026-10", "- 2026-10-08 — New");
    expect(out.split("\n").filter((l) => l.startsWith("- "))).toEqual(["- 2026-10-08 — New", "- 2026-10-02 — Earlier (vm: a, by: claude-code)"]);
    expect(out.startsWith("# Changelog 2026-10\n")).toBe(true);
  });
  it("creates a new month file from the template (month rollover)", () => {
    const out = addChangelogLine(undefined, "2026-11", "- 2026-11-01 — First");
    expect(out.startsWith("# Changelog 2026-11\n")).toBe(true);
    expect(out.trimEnd().endsWith("- 2026-11-01 — First")).toBe(true);
  });
  it("adds the first entry to a header-only file", () => {
    const out = addChangelogLine("# Changelog 2026-10\n\n", "2026-10", "- 2026-10-08 — A");
    expect(out).toBe("# Changelog 2026-10\n\n- 2026-10-08 — A\n");
  });
});

describe("addInboxLine", () => {
  it("appends at the bottom with a trailing newline", () => {
    expect(addInboxLine("# Inbox\n\nstub", "- x")).toBe("# Inbox\n\nstub\n- x\n");
    expect(addInboxLine(undefined, "- x")).toBe("# Inbox\n\n- x\n");
  });
});

describe("planQuickAdd", () => {
  it("logs to an existing VM: changelog, recent changes, last_updated, INDEX", () => {
    const plan = planQuickAdd({
      target: { kind: "vm", name: "prod-api-01" },
      note: "Upgraded nginx to 1.27",
      tag: "upgrade",
      today: TODAY,
      files: files([{ path: "changelog/2026-10.md", content: CHANGELOG }]),
    });
    expect(plan.edits.map((e) => e.path).sort()).toEqual(["INDEX.md", "changelog/2026-10.md", "vms/prod-api-01.md"]);
    expect(plan.message).toBe("log prod-api-01: Upgraded nginx to 1.27");

    const changelog = get(plan, "changelog/2026-10.md")!;
    expect(changelog).toContain("- 2026-10-08 — Upgraded nginx to 1.27 (vm: prod-api-01, tag: upgrade, by: mochi)\n- 2026-10-02");

    const vm = get(plan, "vms/prod-api-01.md")!;
    const fm = readFrontmatter(parseMarkdown(vm));
    expect(fm.last_updated).toBe(TODAY);
    expect(fm.updated_by).toBe("mochi");
    expect(fm.provider).toBe("DigitalOcean");
    expect(vm).toContain("## Recent Changes\n- 2026-10-08 — Upgraded nginx to 1.27 (by: mochi)\n- 2026-09-01 — Older change");
    expect(vm).toContain("## Purpose\nAPI box.");
    expect(vm).toContain("- [ ] nothing");

    const index = get(plan, "INDEX.md")!;
    expect(index).toContain("| [prod-api-01](vms/prod-api-01.md) | DigitalOcean | 2026-10-08 |");
  });

  it("creates the monthly changelog when it does not exist yet", () => {
    const plan = planQuickAdd({ target: { kind: "vm", name: "prod-api-01" }, note: "x", today: "2026-11-01", files: files() });
    expect(get(plan, "changelog/2026-11.md")).toMatch(/^# Changelog 2026-11\n/);
  });

  it("creates a new VM from the template with placeholders resolved", () => {
    const plan = planQuickAdd({ target: { kind: "vm", name: "staging-01" }, note: "Provisioned box", tag: "deploy", today: TODAY, files: files() });
    expect(plan.message).toBe("add staging-01: Provisioned box");
    const text = get(plan, "vms/staging-01.md")!;
    const entry = parseEntry("vms/staging-01.md", text);
    expect(entry).toMatchObject({ kind: "vm", name: "staging-01", lastUpdated: TODAY });
    expect(readFrontmatter(parseMarkdown(text)).updated_by).toBe("mochi");
    expect(text).not.toContain("<YYYY-MM-DD>");
    expect(text).not.toContain("<vm-name>");
    expect(text).toContain("## Recent Changes\n- 2026-10-08 — Provisioned box (by: mochi)");
    expect(text).toContain("## Deployed");
    expect(get(plan, "INDEX.md")).toContain("[staging-01](vms/staging-01.md)");
    expect(get(plan, "INDEX.md")).toContain("[prod-api-01](vms/prod-api-01.md)");
  });

  it("creates a new project from the template", () => {
    const plan = planQuickAdd({ target: { kind: "project", name: "nexus-ai" }, note: "Started tracking", today: TODAY, files: files() });
    const text = get(plan, "projects/nexus-ai.md")!;
    expect(parseEntry("projects/nexus-ai.md", text)).toMatchObject({ kind: "project", name: "nexus-ai", lastUpdated: TODAY });
    expect(text).toContain("## Recent Changes\n- 2026-10-08 — Started tracking (by: mochi)");
    expect(get(plan, "changelog/2026-10.md")).toContain("(project: nexus-ai, by: mochi)");
  });

  it("without a target appends to the inbox only", () => {
    const plan = planQuickAdd({ target: null, note: "Check disk on db box", tag: "incident", today: TODAY, files: files() });
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0].path).toBe("inbox.md");
    expect(plan.edits[0].content).toBe("# Inbox\n\nstub\n- 2026-10-08 — Check disk on db box (tag: incident, by: mochi)\n");
  });

  it("omits the tag when none is chosen", () => {
    const plan = planQuickAdd({ target: null, note: "n", today: TODAY, files: files() });
    expect(plan.edits[0].content).toContain("- 2026-10-08 — n (by: mochi)");
  });

  it("rejects empty notes, bad names and bad dates", () => {
    const base = { target: { kind: "vm" as const, name: "ok" }, note: "n", today: TODAY, files: files() };
    expect(() => planQuickAdd({ ...base, note: "   \n " })).toThrow(QuickAddError);
    expect(() => planQuickAdd({ ...base, target: { kind: "vm", name: "../evil" } })).toThrow(/Names may only/);
    expect(() => planQuickAdd({ ...base, target: { kind: "vm", name: "a/b" } })).toThrow(QuickAddError);
    expect(() => planQuickAdd({ ...base, target: { kind: "vm", name: "" } })).toThrow(QuickAddError);
    expect(() => planQuickAdd({ ...base, today: "08/10/2026" })).toThrow(/date/);
  });

  it("never lets a multi-line note break the changelog format", () => {
    const plan = planQuickAdd({ target: { kind: "vm", name: "prod-api-01" }, note: "line one\n- 2020-01-01 — fake entry", today: TODAY, files: files() });
    const lines = get(plan, "changelog/2026-10.md")!.split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(1);
  });

  it("does not touch other files or invent edits for unreadable vm files", () => {
    const plan = planQuickAdd({
      target: { kind: "vm", name: "prod-api-01" },
      note: "x",
      today: TODAY,
      files: files([{ path: "vms/broken.md", content: "no frontmatter" }]),
    });
    expect(get(plan, "vms/broken.md")).toBeUndefined();
    expect(get(plan, "INDEX.md")).not.toContain("broken");
  });
});
