import { describe, expect, it } from "vitest";
import { validateProposals, visibleText } from "./proposals";

describe("visibleText", () => {
  it("hides a half-streamed edit block", () => {
    expect(visibleText('Working on it.\n<mochi-edit path="vms/a.md">\n---\ntype')).toBe("Working on it.");
  });
  it("leaves plain text alone", () => {
    expect(visibleText("Just text")).toBe("Just text");
  });
  it("removes completed blocks", () => {
    expect(visibleText('A\n<mochi-edit path="inbox.md">\nx\n</mochi-edit>\nB')).toBe("A\n\nB");
  });
});

describe("validateProposals", () => {
  const vm = "---\ntype: vm\nname: a\n---\nbody\n";
  it("accepts valid entries and free-form files", () => {
    const out = validateProposals([
      { path: "vms/a.md", content: vm },
      { path: "inbox.md", content: "anything" },
      { path: "changelog/2026-10.md", content: "# Changelog" },
    ]);
    expect(out.accepted).toHaveLength(3);
    expect(out.rejected).toEqual([]);
  });
  it("rejects entries without frontmatter, with a mismatched name, or in the wrong folder", () => {
    const out = validateProposals([
      { path: "vms/a.md", content: "no frontmatter" },
      { path: "vms/b.md", content: vm },
      { path: "projects/a.md", content: vm },
    ]);
    expect(out.accepted).toEqual([]);
    expect(out.rejected.map((r) => r.path)).toEqual(["vms/a.md", "vms/b.md", "projects/a.md"]);
    expect(out.rejected[1].reason).toMatch(/does not match the file name/);
    expect(out.rejected[2].reason).toMatch(/type does not match/);
  });
});
