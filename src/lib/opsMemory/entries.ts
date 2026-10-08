import { FrontmatterError, parseMarkdown, readFrontmatter } from "./frontmatter";
import type { EntryKind, FrontmatterData, OpsEntry, ValidationIssue } from "./types";

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Validate the frontmatter of a vm or project file. Returns an empty list when valid. */
export function validateFrontmatter(data: FrontmatterData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { type, name, last_updated, deployed_on } = data;

  if (type !== "vm" && type !== "project") {
    issues.push({ field: "type", message: 'must be "vm" or "project"' });
  }
  if (typeof name !== "string" || name === "") {
    issues.push({ field: "name", message: "is required" });
  } else if (!NAME_RE.test(name)) {
    issues.push({ field: "name", message: "may only contain letters, digits, '.', '_' and '-'" });
  }
  if (last_updated !== undefined && !isIsoDate(last_updated)) {
    issues.push({ field: "last_updated", message: "must be a YYYY-MM-DD date" });
  }
  if (deployed_on !== undefined && !(Array.isArray(deployed_on) && deployed_on.every((v) => typeof v === "string"))) {
    issues.push({ field: "deployed_on", message: "must be a list of VM names" });
  }
  return issues;
}

const asString = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/**
 * Build an {@link OpsEntry} from a file's text. Throws {@link FrontmatterError} when the
 * file is not a valid vm/project file.
 */
export function parseEntry(path: string, text: string): OpsEntry {
  const data = readFrontmatter(parseMarkdown(text));
  const issues = validateFrontmatter(data);
  if (issues.length > 0) {
    throw new FrontmatterError(`${path}: ${issues.map((i) => `${i.field} ${i.message}`).join("; ")}`);
  }
  const kind = data.type as EntryKind;
  return {
    kind,
    name: data.name as string,
    path: path.replace(/\\/g, "/"),
    lastUpdated: asString(data.last_updated),
    detail: asString(kind === "vm" ? data.provider : data.repo),
    deployedOn: kind === "project" ? ((data.deployed_on as string[] | undefined) ?? []) : [],
  };
}
