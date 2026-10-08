import vmTemplate from "../../../templates/vm.md?raw";
import projectTemplate from "../../../templates/project.md?raw";
import changelogTemplate from "../../../templates/changelog.md?raw";
import { NAME_RE, isIsoDate, parseEntry } from "./entries";
import { parseMarkdown, serializeMarkdown, setField } from "./frontmatter";
import { generateIndex } from "./indexGen";
import type { EntryKind, OpsEntry } from "./types";

export const QUICK_TAGS = ["deploy", "config", "incident", "upgrade"] as const;
export type QuickTag = (typeof QUICK_TAGS)[number];

export interface QuickAddInput {
  /** Where the note goes. `null` appends to inbox.md. */
  target: { kind: EntryKind; name: string } | null;
  note: string;
  tag?: QuickTag;
  /** YYYY-MM-DD */
  today: string;
  /** All current Ops Memory files (path -> content). */
  files: { path: string; content: string }[];
}

export interface QuickAddPlan {
  edits: { path: string; content: string }[];
  /** Commit subject (without the `mochi: ` prefix). */
  message: string;
}

export class QuickAddError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuickAddError";
  }
}

const BY = "mochi";

const targetPath = (kind: EntryKind, name: string) => `${kind === "vm" ? "vms" : "projects"}/${name}.md`;

/** Collapse whitespace and newlines so the note stays on one changelog line. */
export function cleanNote(note: string): string {
  return note.replace(/\s+/g, " ").trim();
}

/** Lines still holding template placeholders (e.g. `- <YYYY-MM-DD> — <what>`). */
const isPlaceholderLine = (l: string) => /<YYYY-MM-DD>/.test(l);

function withTrailingNewline(text: string): string {
  return text === "" || text.endsWith("\n") ? text : text + "\n";
}

/** Insert a bullet right after the "## Recent Changes" heading, creating the section if missing. */
export function addRecentChange(body: string, bullet: string): string {
  const eol = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^##\s+Recent Changes\s*$/.test(l));
  if (idx === -1) {
    const base = withTrailingNewline(body);
    const sep = base === "" ? "" : eol;
    return `${base}${sep}## Recent Changes${eol}${bullet}${eol}`;
  }
  // Drop template placeholder bullets directly under the heading.
  let end = idx + 1;
  while (end < lines.length && (lines[end].trim() === "" || isPlaceholderLine(lines[end]))) end++;
  const rest = lines.slice(end);
  const head = lines.slice(0, idx + 1);
  // An empty section would run into the next heading; keep a blank line between them.
  const needsBlank = rest.length > 0 && /^#/.test(rest[0]);
  return [...head, bullet, ...(needsBlank ? [""] : []), ...rest].join(eol);
}

/** Insert a changelog bullet at the top of the month file (newest first), creating the file if needed. */
export function addChangelogLine(existing: string | undefined, month: string, line: string): string {
  const base = existing ?? changelogTemplate.replace("<YYYY-MM>", month);
  const eol = base.includes("\r\n") ? "\r\n" : "\n";
  const lines = base.split(/\r?\n/);
  const first = lines.findIndex((l) => /^- /.test(l));
  if (first === -1) {
    const trimmed = base.replace(/(\r?\n)*$/, "");
    return `${trimmed}${eol}${eol}${line}${eol}`;
  }
  lines.splice(first, 0, line);
  return lines.join(eol);
}

/** Append to inbox.md (newest at the bottom). */
export function addInboxLine(existing: string | undefined, line: string): string {
  const base = withTrailingNewline(existing ?? "# Inbox\n\n");
  return `${base}${line}\n`;
}

function newEntryFile(kind: EntryKind, name: string, today: string): string {
  const template = kind === "vm" ? vmTemplate : projectTemplate;
  let text = template
    .replace(kind === "vm" ? "<vm-name>" : "<project-name>", name)
    .replace("last_updated: <YYYY-MM-DD>", `last_updated: ${today}`)
    .replace("<claude-code | mochi | manual>", BY);
  // Remaining placeholder lines (example bullets) are removed.
  text = text
    .split("\n")
    .filter((l) => !isPlaceholderLine(l))
    .join("\n");
  return text;
}

function entriesOf(files: { path: string; content: string }[]): OpsEntry[] {
  const out: OpsEntry[] = [];
  for (const f of files) {
    if (!/^(vms|projects)\/[^/]+\.md$/.test(f.path)) continue;
    try {
      out.push(parseEntry(f.path, f.content));
    } catch {
      // Unreadable files stay out of the index.
    }
  }
  return out;
}

/**
 * Work out every file change for one quick note. Pure: nothing is written here.
 * Throws {@link QuickAddError} for invalid input.
 */
export function planQuickAdd(input: QuickAddInput): QuickAddPlan {
  const note = cleanNote(input.note);
  if (note === "") throw new QuickAddError("Write a short note first.");
  if (!isIsoDate(input.today)) throw new QuickAddError("Invalid date.");
  const { today, tag, target } = input;
  const month = today.slice(0, 7);
  const byPath = new Map(input.files.map((f) => [f.path, f.content]));
  const edits = new Map<string, string>();
  const tagPart = tag ? `, tag: ${tag}` : "";

  // No target: inbox only.
  if (!target) {
    const path = "inbox.md";
    edits.set(path, addInboxLine(byPath.get(path), `- ${today} — ${note} (${tag ? `tag: ${tag}, ` : ""}by: ${BY})`));
    return { edits: [...edits].map(([path, content]) => ({ path, content })), message: `inbox: ${note}` };
  }

  const name = target.name.trim();
  if (!NAME_RE.test(name)) {
    throw new QuickAddError("Names may only contain letters, digits, '.', '_' and '-'.");
  }
  const path = targetPath(target.kind, name);
  const exists = byPath.has(path);

  // Changelog line.
  const changelogPath = `changelog/${month}.md`;
  const changeLine = `- ${today} — ${note} (${target.kind}: ${name}${tagPart}, by: ${BY})`;
  edits.set(changelogPath, addChangelogLine(byPath.get(changelogPath), month, changeLine));

  // Target file: Recent Changes + last_updated.
  const source = exists ? byPath.get(path)! : newEntryFile(target.kind, name, today);
  const doc = parseMarkdown(source);
  let updated = { ...doc, body: addRecentChange(doc.body, `- ${today} — ${note} (by: ${BY})`) };
  updated = setField(updated, "last_updated", today);
  if (target.kind === "vm") updated = setField(updated, "updated_by", BY);
  const content = serializeMarkdown(updated);
  edits.set(path, content);

  // INDEX.md from the resulting set of files.
  const merged = input.files.filter((f) => !edits.has(f.path)).concat([...edits].map(([p, c]) => ({ path: p, content: c })));
  edits.set("INDEX.md", generateIndex(entriesOf(merged), today));

  return {
    edits: [...edits].map(([path, content]) => ({ path, content })),
    message: `${exists ? "log" : "add"} ${name}: ${note}`,
  };
}
