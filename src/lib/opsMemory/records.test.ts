import { describe, expect, it } from "vitest";
import { inlineSegments, parseInbox, parseRecord, recordKind } from "./records";

const VM = `---
last_updated: 2026-10-08
updated_by: claude-code
---
# click-print-vm

GCP \`graphite-tesla-331908\` / \`asia-south1-a\`, e2-medium, Ubuntu 22.04, IP 34.93.253.120.

## Deployed
- click-print (docker, \`/opt/click-print\`): \`web\` on :80.
- cutwater (docker, \`/opt/cutwater\`): :8085.

## Recent Changes
- 2026-10-08: Read-only inspection only.
  Planned: nabco nginx takes :80.
`;

const INBOX = `# Inbox

Quick notes.

- 2026-10-07 — older note (updated_by: claude-code)
- 2026-10-08 — Review needed: infra commands ran in project "personal-assistant" (cwd: D:/x) but not updated (by: mochi-hook)
- 2026-10-08 — click-print: project note created (updated_by: claude-code)
not a record line
`;

describe("recordKind", () => {
  it("derives the kind from the path", () => {
    expect(recordKind("vms/a.md")).toBe("vm");
    expect(recordKind("projects/a.md")).toBe("project");
    expect(recordKind("changelog/2026-10.md")).toBe("changelog");
    expect(recordKind("inbox.md")).toBe("inbox");
    expect(recordKind("INDEX.md")).toBe("other");
  });
});

describe("parseRecord", () => {
  it("reads a loose vm file with no type or name", () => {
    const r = parseRecord("vms/click-print-vm.md", VM);
    expect(r.title).toBe("click-print-vm");
    expect(r.meta).toMatchObject({ lastUpdated: "2026-10-08", updatedBy: "claude-code" });
    expect(r.facts).toEqual([
      { label: "Provider", value: "GCP" },
      { label: "Zone", value: "asia-south1-a" },
      { label: "IP", value: "34.93.253.120" },
      { label: "OS", value: "Ubuntu 22.04" },
    ]);
    expect(r.sections.map((s) => s.heading)).toEqual(["Deployed", "Recent Changes"]);
    expect(r.sections[0].items).toHaveLength(2);
  });

  it("splits dated items and joins continuation lines", () => {
    const change = parseRecord("vms/click-print-vm.md", VM).sections[1].items[0];
    expect(change.date).toBe("2026-10-08");
    expect(change.text).toBe("Read-only inspection only. Planned: nabco nginx takes :80.");
  });

  it("extracts author and tag from changelog lines", () => {
    const r = parseRecord(
      "changelog/2026-10.md",
      "# Changelog 2026-10\n\n- 2026-10-08 click-print: CI made serial (claude-code)\n",
    );
    expect(r.sections[0].heading).toBe("Changes");
    expect(r.sections[0].items[0]).toEqual({ date: "2026-10-08", tag: "click-print", text: "CI made serial", author: "claude-code" });
  });

  it("reads project frontmatter links and survives broken frontmatter", () => {
    const ok = parseRecord("projects/p.md", "---\nproject: p\nvm: v\n---\n# P\n");
    expect(ok.meta).toMatchObject({ project: "p", vm: "v" });
    const bad = parseRecord("projects/p.md", "---\n: : [\n---\n# P\n- x\n");
    expect(bad.title).toBe("P");
    expect(bad.meta).toEqual({});
  });

  it("falls back to the file name and tolerates empty input", () => {
    expect(parseRecord("vms/x.md", "").title).toBe("x");
    expect(parseRecord("vms/x.md", "").sections).toEqual([]);
  });
});

describe("parseInbox", () => {
  const items = parseInbox(INBOX);

  it("lists record lines only, newest first (later line wins on ties)", () => {
    expect(items.map((i) => i.date)).toEqual(["2026-10-08", "2026-10-08", "2026-10-07"]);
    expect(items[0].project).toBe("click-print");
    expect(items[1].kind).toBe("review");
  });

  it("flags hook stubs and extracts the project", () => {
    expect(items[1]).toMatchObject({ kind: "review", author: "mochi-hook", project: "personal-assistant" });
    expect(items[2]).toMatchObject({ kind: "note", author: "claude-code", text: "older note" });
  });

  it("is empty for a blank inbox", () => {
    expect(parseInbox("# Inbox\n")).toEqual([]);
  });
});

describe("inlineSegments", () => {
  it("marks code spans", () => {
    expect(inlineSegments("run `ls` now")).toEqual([
      { text: "run ", code: false },
      { text: "ls", code: true },
      { text: " now", code: false },
    ]);
  });
});
