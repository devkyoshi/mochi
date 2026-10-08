import { describe, expect, it } from "vitest";
import { FrontmatterError } from "./frontmatter";
import { isIsoDate, parseEntry, validateFrontmatter } from "./entries";

const VM = `---
type: vm
name: prod-api-01
provider: DigitalOcean
last_updated: 2026-10-07
---
body
`;
const PROJECT = `---
type: project
name: nexus-ai
repo: https://example.com/nexus-ai.git
deployed_on: [prod-api-01, staging-01]
last_updated: 2026-10-06
---
`;

describe("isIsoDate", () => {
  it("accepts real dates", () => {
    expect(isIsoDate("2026-10-07")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
  });
  it("rejects malformed and impossible dates", () => {
    for (const v of ["2026-13-01", "2026-02-30", "2023-02-29", "26-10-07", "2026-1-7", "", 20261007, null, undefined]) {
      expect(isIsoDate(v)).toBe(false);
    }
  });
});

describe("validateFrontmatter", () => {
  it("passes a valid vm", () => {
    expect(validateFrontmatter({ type: "vm", name: "a-1", last_updated: "2026-10-07" })).toEqual([]);
  });
  it("flags a bad type, missing name and bad date", () => {
    const fields = validateFrontmatter({ type: "server", last_updated: "yesterday" }).map((i) => i.field);
    expect(fields).toEqual(["type", "name", "last_updated"]);
  });
  it("rejects path-like names", () => {
    expect(validateFrontmatter({ type: "vm", name: "../etc/passwd" }).map((i) => i.field)).toEqual(["name"]);
    expect(validateFrontmatter({ type: "vm", name: "a/b" })).toHaveLength(1);
  });
  it("requires deployed_on to be a string list", () => {
    expect(validateFrontmatter({ type: "project", name: "p", deployed_on: "vm1" })).toHaveLength(1);
    expect(validateFrontmatter({ type: "project", name: "p", deployed_on: [1] })).toHaveLength(1);
    expect(validateFrontmatter({ type: "project", name: "p", deployed_on: ["vm1"] })).toEqual([]);
  });
});

describe("parseEntry", () => {
  it("builds a vm entry", () => {
    expect(parseEntry("vms\\prod-api-01.md", VM)).toEqual({
      kind: "vm",
      name: "prod-api-01",
      path: "vms/prod-api-01.md",
      lastUpdated: "2026-10-07",
      detail: "DigitalOcean",
      deployedOn: [],
    });
  });
  it("builds a project entry with deployments", () => {
    const e = parseEntry("projects/nexus-ai.md", PROJECT);
    expect(e.kind).toBe("project");
    expect(e.deployedOn).toEqual(["prod-api-01", "staging-01"]);
    expect(e.detail).toBe("https://example.com/nexus-ai.git");
  });
  it("throws FrontmatterError for invalid files", () => {
    expect(() => parseEntry("vms/x.md", "no frontmatter")).toThrow(FrontmatterError);
    expect(() => parseEntry("vms/x.md", "---\ntype: vm\n---\n")).toThrow(/name is required/);
  });
});
