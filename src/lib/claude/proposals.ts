import { NAME_RE, parseEntry } from "../opsMemory";

export interface EditProposal {
  /** Relative path inside Ops Memory. */
  path: string;
  /** Complete new file content. */
  content: string;
}

export interface ParsedReply {
  /** The reply with the edit blocks removed (what to show as chat text). */
  text: string;
  proposals: EditProposal[];
  /** Blocks that were dropped, with the reason (shown to the user as a warning). */
  rejected: { path: string; reason: string }[];
}

const BLOCK_RE = /<mochi-edit\s+path="([^"]*)">\r?\n?([\s\S]*?)<\/mochi-edit>/g;

const ALLOWED_DIRS = ["vms", "projects", "changelog"];
const ALLOWED_ROOT_FILES = ["inbox.md", "INDEX.md"];

/**
 * Check a path Claude wants to edit. Only markdown inside the known Ops Memory layout is allowed;
 * Rust re-validates everything, this is the first line of defence and gives clear messages.
 * Returns an error message, or null when the path is fine.
 */
export function checkProposalPath(path: string): string | null {
  if (path === "" || path.includes("\\") || path.includes("\0")) return "invalid path";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "absolute paths are not allowed";
  const parts = path.split("/");
  if (parts.some((p) => p === "" || p === "." || p === ".." || p.toLowerCase() === ".git")) return "path escapes Ops Memory";
  if (!path.endsWith(".md")) return "only .md files can be edited";
  if (parts.length === 1) return ALLOWED_ROOT_FILES.includes(path) ? null : "not a known Ops Memory file";
  if (parts.length !== 2 || !ALLOWED_DIRS.includes(parts[0])) return "not a known Ops Memory folder";
  const base = parts[1].slice(0, -3);
  if (parts[0] === "changelog") return /^\d{4}-\d{2}$/.test(base) ? null : "changelog files are named YYYY-MM.md";
  return NAME_RE.test(base) ? null : "invalid file name";
}

/** Split a reply into chat text and validated edit proposals. */
export function parseReply(reply: string): ParsedReply {
  const proposals: EditProposal[] = [];
  const rejected: ParsedReply["rejected"] = [];
  const seen = new Set<string>();

  const text = reply
    .replace(BLOCK_RE, (_m, path: string, body: string) => {
      const problem = checkProposalPath(path) ?? (seen.has(path) ? "duplicate edit for the same file" : null);
      if (problem) {
        rejected.push({ path, reason: problem });
      } else {
        seen.add(path);
        proposals.push({ path, content: body });
      }
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, proposals, rejected };
}

/** Hide a trailing, still-streaming edit block so half-written files never flash in the chat. */
export function visibleText(partial: string): string {
  const open = partial.indexOf("<mochi-edit");
  const closedBefore = open === -1 ? true : /<\/mochi-edit>/.test(partial.slice(open));
  if (open === -1) return partial;
  if (closedBefore) return parseReply(partial).text;
  return partial.slice(0, open).trimEnd();
}

/**
 * Extra checks for proposals touching vms/ or projects/: the new content must still be a valid entry
 * (frontmatter with type and name, matching the file name). Returns [accepted, rejected].
 */
export function validateProposals(proposals: EditProposal[]): { accepted: EditProposal[]; rejected: { path: string; reason: string }[] } {
  const accepted: EditProposal[] = [];
  const rejected: { path: string; reason: string }[] = [];
  for (const p of proposals) {
    if (/^(vms|projects)\//.test(p.path)) {
      try {
        const entry = parseEntry(p.path, p.content);
        const fileName = p.path.split("/")[1].replace(/\.md$/, "");
        if (entry.name !== fileName) throw new Error(`name "${entry.name}" does not match the file name`);
        if (entry.kind !== (p.path.startsWith("vms/") ? "vm" : "project")) throw new Error("type does not match the folder");
      } catch (e) {
        rejected.push({ path: p.path, reason: (e as Error).message });
        continue;
      }
    }
    accepted.push(p);
  }
  return { accepted, rejected };
}
