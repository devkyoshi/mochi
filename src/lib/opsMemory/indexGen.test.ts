import { describe, expect, it } from "vitest";
import { generateIndex } from "./indexGen";
import type { OpsEntry } from "./types";

const vm = (name: string, extra: Partial<OpsEntry> = {}): OpsEntry => ({
  kind: "vm",
  name,
  path: `vms/${name}.md`,
  deployedOn: [],
  ...extra,
});
const project = (name: string, deployedOn: string[], extra: Partial<OpsEntry> = {}): OpsEntry => ({
  kind: "project",
  name,
  path: `projects/${name}.md`,
  deployedOn,
  ...extra,
});

describe("generateIndex", () => {
  it("renders an empty index", () => {
    const out = generateIndex([], "2026-10-08");
    expect(out).toContain("## VMs (0)");
    expect(out).toContain("## Projects (0)");
    expect(out.match(/_None yet\._/g)).toHaveLength(2);
  });

  it("lists VMs and projects with cross references", () => {
    const out = generateIndex(
      [
        vm("staging-01", { detail: "AWS", lastUpdated: "2026-10-01" }),
        vm("prod-api-01", { detail: "DigitalOcean", lastUpdated: "2026-10-07" }),
        project("nexus-ai", ["prod-api-01", "staging-01"], { detail: "git@x:nexus.git", lastUpdated: "2026-10-06" }),
        project("fuelsmart", ["prod-api-01"]),
      ],
      "2026-10-08",
    );
    expect(out).toContain("| [prod-api-01](vms/prod-api-01.md) | DigitalOcean | 2026-10-07 | fuelsmart, nexus-ai |");
    expect(out).toContain("| [staging-01](vms/staging-01.md) | AWS | 2026-10-01 | nexus-ai |");
    expect(out).toContain("| [fuelsmart](projects/fuelsmart.md) | — | prod-api-01 | — |");
    expect(out).toContain("| [nexus-ai](projects/nexus-ai.md) | git@x:nexus.git | prod-api-01, staging-01 | 2026-10-06 |");
  });

  it("is sorted and deterministic regardless of input order", () => {
    const entries = [vm("b"), vm("a"), project("z", []), project("y", [])];
    const out = generateIndex(entries, "2026-10-08");
    expect(generateIndex([...entries].reverse(), "2026-10-08")).toBe(out);
    expect(out.indexOf("[a]")).toBeLessThan(out.indexOf("[b]"));
    expect(out.indexOf("[y]")).toBeLessThan(out.indexOf("[z]"));
  });

  it("escapes pipes and uses only LF line endings, ending with one newline", () => {
    const out = generateIndex([vm("a", { detail: "x|y" })], "2026-10-08");
    expect(out).toContain("x\\|y");
    expect(out).not.toContain("\r");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  it("includes the generation date", () => {
    expect(generateIndex([], "2026-10-08")).toContain("Generated: 2026-10-08");
  });
});
