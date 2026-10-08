import { parseMarkdown, readFrontmatter } from "./frontmatter";
import { parseRecord, recordKind } from "./records";

export interface DirEntry {
  kind: "vm" | "project";
  /** File name without `.md`; the stable key used for links. */
  name: string;
  path: string;
  title: string;
  lastUpdated?: string;
  updatedBy?: string;
  /** One line shown under the name in lists. */
  subtitle: string;
  /** Names of linked entries: the host VM for a project, hosted projects for a VM. */
  related: string[];
}

export interface Directory {
  vms: DirEntry[];
  projects: DirEntry[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** True when `text` mentions `name` as a whole token (so `click-print` does not match `click-print-vm`). */
export const mentions = (text: string, name: string): boolean =>
  new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`, "i").test(text);

function frontmatterOf(text: string): Record<string, unknown> {
  try {
    return readFrontmatter(parseMarkdown(text));
  } catch {
    return {};
  }
}

/**
 * Build the VM and project lists from file paths alone. Real Ops Memory files often lack the
 * `type:`/`name:` frontmatter the strict schema asks for, so nothing here depends on it.
 */
export function buildDirectory(files: { path: string; content: string }[]): Directory {
  const raw = files
    .filter((f) => ["vm", "project"].includes(recordKind(f.path)))
    .map((f) => {
      const rec = parseRecord(f.path, f.content);
      const name = f.path.split("/").pop()!.replace(/\.md$/, "");
      return { f, rec, name, kind: rec.kind as "vm" | "project", fm: frontmatterOf(f.content) };
    });
  const vmNames = raw.filter((r) => r.kind === "vm").map((r) => r.name);
  const projectNames = raw.filter((r) => r.kind === "project").map((r) => r.name);

  const hostOf = (r: (typeof raw)[number]): string[] => {
    const declared = typeof r.fm.vm === "string" ? [r.fm.vm] : Array.isArray(r.fm.deployed_on) ? (r.fm.deployed_on as string[]) : [];
    const found = vmNames.filter((v) => mentions(r.f.content, v));
    return [...new Set([...declared, ...found])].filter((v) => vmNames.includes(v));
  };
  const hosts = new Map(raw.filter((r) => r.kind === "project").map((r) => [r.name, hostOf(r)]));

  const entries = raw.map((r): DirEntry => {
    const related =
      r.kind === "project"
        ? (hosts.get(r.name) ?? [])
        : projectNames.filter((p) => hosts.get(p)?.includes(r.name) || mentions(r.f.content, p));
    const facts = r.rec.facts.filter((x) => x.label === "IP" || x.label === "Provider").map((x) => x.value);
    const subtitle =
      r.kind === "vm"
        ? facts.join(" · ") || (r.rec.meta.lastUpdated ? `Updated ${r.rec.meta.lastUpdated}` : "")
        : [related[0], r.rec.meta.lastUpdated && `Updated ${r.rec.meta.lastUpdated}`].filter(Boolean).join(" · ");
    return {
      kind: r.kind,
      name: r.name,
      path: r.f.path,
      title: r.rec.title,
      lastUpdated: r.rec.meta.lastUpdated,
      updatedBy: r.rec.meta.updatedBy,
      subtitle,
      related: [...new Set(related)],
    };
  });

  const byName = (a: DirEntry, b: DirEntry) => a.name.localeCompare(b.name);
  return {
    vms: entries.filter((e) => e.kind === "vm").sort(byName),
    projects: entries.filter((e) => e.kind === "project").sort(byName),
  };
}

/** Case-insensitive match on name, title and subtitle. */
export function filterEntries(list: DirEntry[], query: string): DirEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((e) => `${e.name} ${e.title} ${e.subtitle}`.toLowerCase().includes(q));
}
