import { describe, expect, it } from "vitest";
import vmTemplate from "../../../templates/vm.md?raw";
import projectTemplate from "../../../templates/project.md?raw";
import inboxTemplate from "../../../templates/inbox.md?raw";
import changelogTemplate from "../../../templates/changelog.md?raw";
import changelogEntry from "../../../templates/changelog-entry.md?raw";
import { parseMarkdown, readFrontmatter, serializeMarkdown } from "./frontmatter";
import { parseEntry } from "./entries";

const ALL = [vmTemplate, projectTemplate, inboxTemplate, changelogTemplate, changelogEntry];

describe("templates", () => {
  it("vm template has the documented frontmatter and sections", () => {
    const data = readFrontmatter(parseMarkdown(vmTemplate));
    expect(data.type).toBe("vm");
    for (const key of ["name", "provider", "host", "os", "last_updated", "updated_by"]) expect(data).toHaveProperty(key);
    for (const h of ["## Purpose", "## Deployed", "## Config Notes", "## Recent Changes", "## Open Issues / TODO"]) {
      expect(vmTemplate).toContain(h);
    }
  });

  it("project template has the documented frontmatter and sections", () => {
    const data = readFrontmatter(parseMarkdown(projectTemplate));
    expect(data.type).toBe("project");
    expect(data.deployed_on).toEqual([]);
    for (const h of ["## Summary", "## Stack", "## Deploy Procedure", "## Recent Changes", "## Known Issues"]) {
      expect(projectTemplate).toContain(h);
    }
  });

  it("filled-in templates parse as valid entries", () => {
    const vm = vmTemplate.replace("<vm-name>", "prod-01").replace("<YYYY-MM-DD>", "2026-10-08");
    expect(parseEntry("vms/prod-01.md", vm).kind).toBe("vm");
    const project = projectTemplate.replace("<project-name>", "app").replace("<YYYY-MM-DD>", "2026-10-08");
    expect(parseEntry("projects/app.md", project).kind).toBe("project");
  });

  it("templates round-trip byte-identically", () => {
    for (const t of ALL) expect(serializeMarkdown(parseMarkdown(t))).toBe(t);
  });

  it("templates contain no secret-looking values", () => {
    for (const t of ALL) expect(t).not.toMatch(/(password|secret|token)\s*[:=]\s*\S+/i);
  });

  it("changelog entry is a single dated bullet", () => {
    expect(changelogEntry.trim().split("\n")).toHaveLength(1);
    expect(changelogEntry).toMatch(/^- <YYYY-MM-DD> — /);
  });
});
