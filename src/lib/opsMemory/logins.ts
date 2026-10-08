import { parseMarkdown, serializeMarkdown } from "./frontmatter";
import type { DevLogin } from "./records";

/**
 * Dev logins live in a `## Dev Logins` markdown table. The Password column only ever says `keychain`
 * (the real password is in the OS keychain) or `—`, so the secret scanner and git never see a password.
 */

export const LOGIN_COLUMNS = ["Label", "URL", "Username", "Role", "Password", "Notes"] as const;

export const isLoginHeading = (h: string) => h.trim().toLowerCase() === "dev logins";

const HEADING_RE = /^#{1,6}\s+/;

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

const isSeparator = (line: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
const cleanCell = (v: string) => v.replace(/\s+/g, " ").replace(/\|/g, "/").trim();

type Column = keyof Omit<DevLogin, "hasPassword"> | "password";
const ALIASES: Record<string, Column> = {
  label: "label",
  name: "label",
  url: "url",
  "login url": "url",
  username: "username",
  user: "username",
  email: "username",
  "email / username": "username",
  role: "role",
  password: "password",
  notes: "notes",
  note: "notes",
};

const headerOf = (line: string): (Column | undefined)[] => cells(line).map((h) => ALIASES[h.toLowerCase()]);

/** Parse table rows (header first). Lines that are not table rows are ignored. */
export function parseLoginRows(lines: string[]): DevLogin[] {
  const rows = lines.filter((l) => l.trim().startsWith("|"));
  if (rows.length === 0) return [];
  const header = headerOf(rows[0]);
  const out: DevLogin[] = [];
  for (const row of rows.slice(1)) {
    if (isSeparator(row)) continue;
    const c = cells(row);
    const get = (k: Column) => (header.indexOf(k) === -1 ? "" : (c[header.indexOf(k)] ?? ""));
    const login: DevLogin = {
      label: get("label"),
      url: get("url"),
      username: get("username"),
      role: get("role"),
      notes: get("notes"),
      hasPassword: get("password").toLowerCase().includes("keychain"),
    };
    if (login.label || login.username) out.push(login);
  }
  return out;
}

function sectionBounds(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((l) => /^#{2,6}\s+/.test(l) && isLoginHeading(l.replace(HEADING_RE, "")));
  if (start === -1) return null;
  const next = lines.findIndex((l, i) => i > start && HEADING_RE.test(l));
  return { start, end: next === -1 ? lines.length : next };
}

/** Dev logins listed in a vm/project file. */
export function parseLogins(text: string): DevLogin[] {
  const lines = parseMarkdown(text).body.split(/\r?\n/);
  const b = sectionBounds(lines);
  return b ? parseLoginRows(lines.slice(b.start + 1, b.end)) : [];
}

/** Keychain account holding a login's password. */
export const loginAccount = (target: string, username: string) => `devlogin:${target}:${username.trim()}`;

const same = (a: { label: string; username: string }, b: { label: string; username: string }) =>
  a.label.trim().toLowerCase() === b.label.trim().toLowerCase() && a.username.trim().toLowerCase() === b.username.trim().toLowerCase();

/**
 * Insert or replace one login row, creating the section and table when missing. Everything else in
 * the file (frontmatter, other sections, line endings) is left as it was.
 */
export function upsertLogin(text: string, login: DevLogin): string {
  const doc = parseMarkdown(text);
  const lines = doc.body.split(/\r?\n/);
  const values = [login.label, login.url, login.username, login.role, "", login.notes].map((v) => cleanCell(v) || "—");
  values[4] = login.hasPassword ? "keychain" : "—";
  const row = `| ${values.join(" | ")} |`;
  const head = `| ${LOGIN_COLUMNS.join(" | ")} |`;
  const sep = `|${LOGIN_COLUMNS.map(() => "---").join("|")}|`;

  const b = sectionBounds(lines);
  let out: string[];
  if (!b) {
    const kept = [...lines];
    while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();
    out = [...kept, ...(kept.length ? [""] : []), "## Dev Logins", "", head, sep, row, ""];
  } else {
    const section = lines.slice(b.start + 1, b.end);
    const t = section.findIndex((l) => l.trim().startsWith("|"));
    if (t === -1) {
      const kept = section.filter((l) => l.trim() !== "");
      section.splice(0, section.length, "", ...kept, ...(kept.length ? [""] : []), head, sep, row, "");
    } else {
      const header = headerOf(section[t]);
      let last = t;
      let replaced = false;
      for (let i = t; i < section.length && section[i].trim().startsWith("|"); i++) {
        last = i;
        if (i === t || isSeparator(section[i])) continue;
        const c = cells(section[i]);
        const at = (k: Column) => (header.indexOf(k) === -1 ? "" : (c[header.indexOf(k)] ?? ""));
        if (same({ label: at("label"), username: at("username") }, login)) {
          section[i] = row;
          replaced = true;
        }
      }
      if (!replaced) section.splice(last + 1, 0, row);
    }
    out = [...lines.slice(0, b.start + 1), ...section, ...lines.slice(b.end)];
  }
  return serializeMarkdown({ ...doc, body: out.join(doc.eol) });
}
