import { describe, expect, it } from "vitest";
import { checkProposalPath, parseReply } from "./proposals";
import { buildContext, SYSTEM_PROMPT } from "./context";

describe("checkProposalPath", () => {
  it("accepts known Ops Memory files", () => {
    for (const p of ["vms/prod-api-01.md", "projects/nexus-ai.md", "changelog/2026-10.md", "inbox.md", "INDEX.md"]) {
      expect(checkProposalPath(p), p).toBeNull();
    }
  });
  it("rejects traversal, absolute, hidden, nested and non-markdown paths", () => {
    const bad = [
      "",
      "../x.md",
      "vms/../../x.md",
      "/etc/passwd",
      "C:/Windows/x.md",
      "C:x.md",
      "vms\\a.md",
      ".git/config",
      "vms/.git/x.md",
      "vms/a.txt",
      "vms/sub/a.md",
      "vms/.md",
      "vms//a.md",
      "other/a.md",
      "random.md",
      "changelog/oct.md",
      "vms/a b.md",
      "vms/a\0.md",
      ".mochi/config.json",
    ];
    for (const p of bad) expect(checkProposalPath(p), JSON.stringify(p)).not.toBeNull();
  });
});

describe("parseReply", () => {
  it("returns plain replies untouched", () => {
    expect(parseReply("Staging runs nginx 1.24.")).toEqual({ text: "Staging runs nginx 1.24.", proposals: [], rejected: [] });
  });

  it("extracts edit blocks and removes them from the text", () => {
    const reply = [
      "I logged the upgrade.",
      "",
      '<mochi-edit path="vms/prod.md">',
      "---",
      "type: vm",
      "name: prod",
      "---",
      "body",
      "</mochi-edit>",
      "",
      "Anything else?",
    ].join("\n");
    const out = parseReply(reply);
    expect(out.proposals).toEqual([{ path: "vms/prod.md", content: "---\ntype: vm\nname: prod\n---\nbody\n" }]);
    expect(out.text).toBe("I logged the upgrade.\n\nAnything else?");
    expect(out.rejected).toEqual([]);
  });

  it("handles several blocks and CRLF", () => {
    const reply = '<mochi-edit path="inbox.md">\r\nline\r\n</mochi-edit>\r\n<mochi-edit path="changelog/2026-10.md">\r\nx\r\n</mochi-edit>';
    const out = parseReply(reply);
    expect(out.proposals.map((p) => p.path)).toEqual(["inbox.md", "changelog/2026-10.md"]);
    expect(out.proposals[0].content).toBe("line\r\n");
  });

  it("rejects blocks with unsafe paths, but keeps the good ones", () => {
    const reply = '<mochi-edit path="../../etc/passwd">\nx\n</mochi-edit>\n<mochi-edit path="vms/ok.md">\ny\n</mochi-edit>';
    const out = parseReply(reply);
    expect(out.proposals.map((p) => p.path)).toEqual(["vms/ok.md"]);
    expect(out.rejected).toEqual([{ path: "../../etc/passwd", reason: "path escapes Ops Memory" }]);
  });

  it("rejects a second edit to the same file", () => {
    const reply = '<mochi-edit path="inbox.md">\na\n</mochi-edit><mochi-edit path="inbox.md">\nb\n</mochi-edit>';
    const out = parseReply(reply);
    expect(out.proposals).toHaveLength(1);
    expect(out.proposals[0].content).toBe("a\n");
    expect(out.rejected[0].reason).toMatch(/duplicate/);
  });

  it("ignores an unterminated block (leaves it as text)", () => {
    const out = parseReply('<mochi-edit path="inbox.md">\nnever closed');
    expect(out.proposals).toEqual([]);
    expect(out.text).toContain("never closed");
  });
});

describe("buildContext", () => {
  const files = [
    { path: "changelog/2026-09.md", content: "old" },
    { path: "changelog/2026-10.md", content: "new" },
    { path: "inbox.md", content: "inbox" },
    { path: "projects/p.md", content: "project" },
    { path: "vms/v.md", content: "vm" },
    { path: "INDEX.md", content: "index" },
  ];

  it("orders by usefulness and puts the newest changelog first", () => {
    const ctx = buildContext(files, new Set());
    expect(ctx.included).toEqual(["INDEX.md", "vms/v.md", "projects/p.md", "inbox.md", "changelog/2026-10.md", "changelog/2026-09.md"]);
    expect(ctx.text).toContain('<file path="vms/v.md">\nvm\n</file>');
    expect(ctx.text.startsWith("Files currently in Ops Memory (6):")).toBe(true);
  });

  it("never includes files flagged as containing secrets", () => {
    const ctx = buildContext(files, new Set(["vms/v.md"]));
    expect(ctx.withheld).toEqual(["vms/v.md"]);
    expect(ctx.included).not.toContain("vms/v.md");
    expect(ctx.text).not.toContain('<file path="vms/v.md">');
  });

  it("drops lowest-priority files first when over budget", () => {
    const big = [
      { path: "INDEX.md", content: "i".repeat(100) },
      { path: "vms/a.md", content: "a".repeat(100) },
      { path: "changelog/2026-10.md", content: "c".repeat(100) },
    ];
    const ctx = buildContext(big, new Set(), 300);
    expect(ctx.included).toEqual(["INDEX.md", "vms/a.md"]);
    expect(ctx.truncated).toEqual(["changelog/2026-10.md"]);
  });

  it("keeps going past one oversized file", () => {
    const ctx = buildContext(
      [
        { path: "vms/huge.md", content: "x".repeat(1000) },
        { path: "vms/small.md", content: "y" },
      ],
      new Set(),
      200,
    );
    expect(ctx.truncated).toEqual(["vms/huge.md"]);
    expect(ctx.included).toEqual(["vms/small.md"]);
  });
});

describe("SYSTEM_PROMPT", () => {
  it("states the schema, the no-secrets rule, the inbox fallback and the edit format", () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER write secret values/);
    expect(SYSTEM_PROMPT).toMatch(/inbox\.md instead of guessing/);
    expect(SYSTEM_PROMPT).toContain('<mochi-edit path="vms/example.md">');
    expect(SYSTEM_PROMPT).toMatch(/cannot run commands or touch files/);
  });
});
