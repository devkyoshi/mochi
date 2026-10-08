/** Kinds of entity files stored in Ops Memory. */
export type EntryKind = "vm" | "project";

export type Eol = "\n" | "\r\n";

/**
 * A markdown file split into its frontmatter and body without losing any bytes.
 * `serialize(parse(text)) === text` always holds when the document is unmodified.
 */
export interface MarkdownDoc {
  /** Opening delimiter line including its line ending (and BOM if present). Empty if no frontmatter. */
  open: string;
  /** Raw text between the delimiters, including each line's ending. */
  frontmatter: string;
  /** Closing delimiter line including its line ending, if any. Empty if no frontmatter. */
  close: string;
  /** Everything after the closing delimiter. */
  body: string;
  /** Dominant line ending of the file, used when inserting new lines. */
  eol: Eol;
}

export type FrontmatterData = Record<string, unknown>;

export interface VmFrontmatter {
  type: "vm";
  name: string;
  provider?: string;
  host?: string;
  os?: string;
  last_updated?: string;
  updated_by?: string;
}

export interface ProjectFrontmatter {
  type: "project";
  name: string;
  repo?: string;
  deployed_on?: string[];
  last_updated?: string;
}

/** Lightweight summary of one vm/project file, used by INDEX generation and the UI. */
export interface OpsEntry {
  kind: EntryKind;
  name: string;
  /** Path relative to the Ops Memory root, always with forward slashes. */
  path: string;
  lastUpdated?: string;
  /** VMs: provider; projects: repo. */
  detail?: string;
  /** Projects only: VM names this project is deployed on. */
  deployedOn: string[];
}

export interface ValidationIssue {
  field: string;
  message: string;
}
