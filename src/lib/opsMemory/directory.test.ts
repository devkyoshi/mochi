import { describe, expect, it } from "vitest";
import { buildDirectory, filterEntries, mentions } from "./directory";
import { describeItem } from "./records";

const files = [
  { path: "vms/click-print-vm.md", content: "---\nlast_updated: 2026-10-08\nupdated_by: claude-code\n---\n# click-print-vm\n\nGCP `asia-south1-a`, IP 34.93.253.120.\n\n## Deployed\n- ethronix-labs-ui: host nginx :8080\n" },
  { path: "projects/click-print.md", content: "---\nproject: click-print\nvm: click-print-vm\nlast_updated: 2026-10-08\n---\n# ClickPrint\n\n## Deployed\n- Host: `click-print-vm`\n" },
  { path: "projects/ethronix-labs-ui.md", content: "# ethronix-labs-ui\n\n- rsyncs to `click-print-vm`\n" },
  { path: "projects/lonely.md", content: "# lonely\n" },
  { path: "inbox.md", content: "# Inbox\n" },
];

describe("buildDirectory", () => {
  const dir = buildDirectory(files);

  it("lists vms and projects by path even without type/name frontmatter", () => {
    expect(dir.vms.map((e) => e.name)).toEqual(["click-print-vm"]);
    expect(dir.projects.map((e) => e.name)).toEqual(["click-print", "ethronix-labs-ui", "lonely"]);
    expect(dir.projects[0].title).toBe("ClickPrint");
  });

  it("links projects to their host vm and back", () => {
    expect(dir.projects[0].related).toEqual(["click-print-vm"]);
    expect(dir.projects[1].related).toEqual(["click-print-vm"]);
    expect(dir.projects[2].related).toEqual([]);
    expect(dir.vms[0].related).toEqual(["click-print", "ethronix-labs-ui"]);
  });

  it("writes a readable subtitle", () => {
    expect(dir.vms[0].subtitle).toBe("GCP · 34.93.253.120");
    expect(dir.projects[0].subtitle).toBe("click-print-vm · Updated 2026-10-08");
  });
});

describe("filterEntries / mentions", () => {
  const { projects } = buildDirectory(files);
  it("filters by name, case-insensitively", () => {
    expect(filterEntries(projects, "ETHRO").map((e) => e.name)).toEqual(["ethronix-labs-ui"]);
    expect(filterEntries(projects, "  ")).toHaveLength(3);
    expect(filterEntries(projects, "zzz")).toEqual([]);
  });
  it("matches whole tokens only", () => {
    expect(mentions("on click-print-vm", "click-print")).toBe(false);
    expect(mentions("on `click-print` now", "click-print")).toBe(true);
  });
});

describe("describeItem", () => {
  it("splits a service line into title, qualifier, body, ports", () => {
    const d = describeItem("click-print (docker, `/opt/click-print`): `web` on :80 (Next.js, container :3000).");
    expect(d.title).toBe("click-print");
    expect(d.meta).toBe("docker, `/opt/click-print`");
    expect(d.ports).toEqual([":80", ":3000"]);
  });
  it("keeps prose without a lead-in whole and finds urls", () => {
    const d = describeItem("Served by host nginx on :8080 (http://34.93.253.120:8080). Secrets: VM_HOST");
    expect(d.title).toBeUndefined();
    expect(d.urls).toEqual(["http://34.93.253.120:8080"]);
    expect(d.ports).toEqual([":8080"]);
  });
});
