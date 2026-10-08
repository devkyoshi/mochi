import { parseMarkdown, readFrontmatter } from "./frontmatter";
import { isIsoDate } from "./entries";
import { isLoginHeading, parseLoginRows } from "./logins";

/**
 * Lenient, display-only view of an Ops Memory file. The markdown stays the source of truth; this
 * turns it into records the UI can render as cards. Real files are looser than docs/schema.md, so
 * nothing here throws and every field is optional.
 */

export type RecordKind = "vm" | "project" | "changelog" | "inbox" | "other";

export interface RecordItem {
  date?: string;
  text: string;
  author?: string;
  /** Leading `name:` label, e.g. the project a changelog line is about. */
  tag?: string;
}

export interface RecordSection {
  heading: string;
  items: RecordItem[];
  paragraphs: string[];
}

/** A dev login. Passwords are never in the file: they live in the OS keychain (`hasPassword` = the Password cell says so). */
export interface DevLogin {
  label: string;
  url: string;
  username: string;
  role: string;
  notes: string;
  hasPassword: boolean;
}

export interface OpsRecord {
  kind: RecordKind;
  title: string;
  /** Intro paragraphs before the first section. */
  summary: string[];
  meta: {
    lastUpdated?: string;
    updatedBy?: string;
    vm?: string;
    project?: string;
    domain?: string;
    liveUrl?: string;
    /** From `live: true|false`; undefined when not stated. */
    live?: boolean;
  };
  facts: { label: string; value: string }[];
  sections: RecordSection[];
  logins: DevLogin[];
}

export interface InboxItem {
  date: string;
  text: string;
  author?: string;
  kind: "review" | "note";
  project?: string;
}

export function recordKind(path: string): RecordKind {
  if (path.startsWith("vms/")) return "vm";
  if (path.startsWith("projects/")) return "project";
  if (path.startsWith("changelog/")) return "changelog";
  if (path === "inbox.md") return "inbox";
  return "other";
}

const DATE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2})\s*(?:[—–:-]\s*)?/;
const AUTHOR_RE = /\s*\((?:(?:updated_)?by:\s*([^)]+?)|(claude-code|mochi-hook|mochi))\)\s*$/;
const TAG_RE = /^([A-Za-z0-9][\w.-]*):\s+/;
const BULLET_RE = /^\s*[-*]\s+(.*)$/;

function parseItem(raw: string): RecordItem {
  let text = raw.trim();
  const item: RecordItem = { text };
  const d = DATE_PREFIX_RE.exec(text);
  if (d && isIsoDate(d[1])) {
    item.date = d[1];
    text = text.slice(d[0].length);
  }
  const a = AUTHOR_RE.exec(text);
  if (a) {
    item.author = (a[1] ?? a[2]).trim();
    text = text.slice(0, a.index);
  }
  const t = TAG_RE.exec(text);
  if (t && item.date) {
    item.tag = t[1];
    text = text.slice(t[0].length);
  }
  item.text = text.trim();
  return item;
}

const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined);

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : v instanceof Date ? v.toISOString().slice(0, 10) : undefined);

const PROVIDERS: [RegExp, string][] = [
  [/\bGCP\b|google cloud/i, "GCP"],
  [/\bAWS\b|amazon web/i, "AWS"],
  [/\bAzure\b/i, "Azure"],
  [/digital\s?ocean/i, "DigitalOcean"],
  [/\bHetzner\b/i, "Hetzner"],
];

/** Best-effort facts from a VM's intro text; only what actually matches is returned. */
function vmFacts(text: string, fm: Record<string, unknown> = {}): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  // Frontmatter wins when the file declares any of these.
  const declared: [string, string][] = [["Provider", "provider"], ["Zone", "zone"], ["Machine", "machine"], ["IP", "ip"], ["OS", "os"]];
  const fromFm = declared.flatMap(([label, key]) => (str(fm[key]) ? [{ label, value: str(fm[key])! }] : []));
  if (fromFm.length > 0) return fromFm;
  const provider = PROVIDERS.find(([re]) => re.test(text));
  if (provider) facts.push({ label: "Provider", value: provider[1] });
  const zone = /\b[a-z]+-[a-z]+\d-[a-z]\b/.exec(text);
  if (zone) facts.push({ label: "Zone", value: zone[0] });
  const ip = /\b(?:\d{1,3}\.){3}\d{1,3}\b/.exec(text);
  if (ip) facts.push({ label: "IP", value: ip[0] });
  const os = /\b(?:Ubuntu|Debian|CentOS|Alpine|Fedora|Rocky)\s?[\d.]*/i.exec(text);
  if (os) facts.push({ label: "OS", value: os[0].trim() });
  return facts;
}

export function parseRecord(path: string, text: string): OpsRecord {
  const kind = recordKind(path);
  const doc = parseMarkdown(text);
  let fm: Record<string, unknown> = {};
  try {
    fm = readFrontmatter(doc) as Record<string, unknown>;
  } catch {
    // Display stays usable with broken frontmatter; the editor surfaces the error.
  }

  const fileName = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
  let title = "";
  const summary: string[] = [];
  const sections: RecordSection[] = [];
  let current: RecordSection | null = null;
  let lastItem: RecordItem | null = null;

  for (const line of doc.body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const h1 = /^#\s+(.*)$/.exec(line);
    const h2 = /^#{2,6}\s+(.*)$/.exec(line);
    if (h1) {
      if (!title) title = h1[1].trim();
      continue;
    }
    if (h2) {
      current = { heading: h2[1].trim(), items: [], paragraphs: [] };
      sections.push(current);
      lastItem = null;
      continue;
    }
    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      if (!current) {
        current = { heading: kind === "changelog" ? "Changes" : "Notes", items: [], paragraphs: [] };
        sections.push(current);
      }
      lastItem = parseItem(bullet[1]);
      current.items.push(lastItem);
    } else if (/^\s+\S/.test(line) && lastItem) {
      lastItem.text += ` ${line.trim()}`;
    } else if (current) {
      current.paragraphs.push(line.trim());
    } else {
      summary.push(line.trim());
    }
  }

  const loginSection = sections.find((s) => isLoginHeading(s.heading));
  return {
    kind,
    title: title || fileName,
    summary,
    meta: {
      lastUpdated: str(fm.last_updated),
      updatedBy: str(fm.updated_by),
      vm: str(fm.vm),
      project: str(fm.project),
      domain: str(fm.domain),
      liveUrl: str(fm.live_url),
      live: bool(fm.live),
    },
    facts: kind === "vm" ? vmFacts(summary.join(" "), fm) : [],
    sections: sections.filter((s) => s !== loginSection && (s.items.length > 0 || s.paragraphs.length > 0)),
    logins: loginSection ? parseLoginRows(loginSection.paragraphs) : [],
  };
}

/** Inbox lines (`- YYYY-MM-DD — text (by: x)`), newest first. File order is oldest first, so ties go to later lines. */
export function parseInbox(text: string): InboxItem[] {
  const items: InboxItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+)$/.exec(line);
    if (!m || !isIsoDate(m[1])) continue;
    const parsed = parseItem(`${m[1]} ${m[2]}`);
    const project = /project\s+"([^"]+)"/.exec(parsed.text)?.[1] ?? parsed.tag;
    items.push({
      date: m[1],
      text: parsed.text,
      author: parsed.author,
      kind: parsed.author === "mochi-hook" ? "review" : "note",
      project,
    });
  }
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => (a.it.date < b.it.date ? 1 : a.it.date > b.it.date ? -1 : b.i - a.i))
    .map(({ it }) => it);
}

/** Split text on `code` spans so the UI can style them without rendering markdown. */
export function inlineSegments(text: string): { text: string; code: boolean }[] {
  return text
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((s) => (s.startsWith("`") && s.endsWith("`") && s.length > 1 ? { text: s.slice(1, -1), code: true } : { text: s, code: false }));
}

export interface ItemDetail {
  /** Short lead-in such as a service name; absent when the line is plain prose. */
  title?: string;
  /** Parenthesised qualifier after the title, e.g. `docker, /opt/app`. */
  meta?: string;
  body: string;
  ports: string[];
  urls: string[];
}

const LEAD_RE = /^([^:(`]{1,48}?)(?:\s*\(([^)]*)\))?:\s+(.*)$/;
const URL_RE = /https?:\/\/[^\s)`]+/g;
const PORT_RE = /(?:^|[\s(`])(:\d{2,5})(?=[\s).,;`]|$)/g;

/** Pull a title, ports and URLs out of a free-text bullet so the UI can lay it out as a card. */
export function describeItem(text: string): ItemDetail {
  const lead = LEAD_RE.exec(text);
  const title = lead?.[1].trim();
  const body = (lead ? lead[3] : text).trim();
  const urls = [...new Set((text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;]+$/, "")))];
  const ports = [...new Set([...text.matchAll(PORT_RE)].map((m) => m[1]))];
  return { title, meta: lead?.[2]?.trim() || undefined, body, ports, urls };
}
