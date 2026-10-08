export interface ContextFile {
  path: string;
  content: string;
}

export interface BuiltContext {
  /** Text to give Claude: the file tree and file contents within the budget. */
  text: string;
  /** Paths included in full. */
  included: string[];
  /** Paths left out because of the size budget. */
  truncated: string[];
  /** Paths left out because they look like they contain secrets (never sent). */
  withheld: string[];
}

export const DEFAULT_BUDGET_CHARS = 60_000;

/** Lower number = included first. */
function priority(path: string): number {
  if (path === "INDEX.md") return 0;
  if (path.startsWith("vms/")) return 1;
  if (path.startsWith("projects/")) return 2;
  if (path === "inbox.md") return 3;
  if (path.startsWith("changelog/")) return 4;
  return 5;
}

/**
 * Build the Ops Memory context for a chat request. Files that the secret scanner flagged are never
 * included. Newer changelog months come first within their group.
 *
 * `flagged` is the set of paths with secret findings (computed by the caller via the scanner).
 */
export function buildContext(files: ContextFile[], flagged: Set<string>, budget = DEFAULT_BUDGET_CHARS): BuiltContext {
  const withheld = files.filter((f) => flagged.has(f.path)).map((f) => f.path);
  const candidates = files
    .filter((f) => !flagged.has(f.path))
    .sort((a, b) => {
      const byPriority = priority(a.path) - priority(b.path);
      if (byPriority !== 0) return byPriority;
      const cmp = a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
      return priority(a.path) === 4 ? -cmp : cmp; // newest changelog month first
    });

  const included: string[] = [];
  const truncated: string[] = [];
  const parts: string[] = [];
  let used = 0;
  for (const f of candidates) {
    const block = `<file path="${f.path}">\n${f.content}${f.content.endsWith("\n") ? "" : "\n"}</file>\n`;
    if (used + block.length > budget) {
      truncated.push(f.path);
      continue;
    }
    used += block.length;
    included.push(f.path);
    parts.push(block);
  }

  const header = `Files currently in Ops Memory (${files.length}):\n${files.map((f) => `- ${f.path}`).join("\n")}\n\n`;
  return { text: header + parts.join("\n"), included, truncated, withheld };
}

export const SYSTEM_PROMPT = `You are Mochi's assistant. You help the user understand and update "Ops Memory": a folder of markdown files about their VMs and deployments.

Layout: vms/<name>.md (type: vm), projects/<name>.md (type: project), changelog/YYYY-MM.md (newest entry first), inbox.md (quick notes), INDEX.md (generated, do not edit).
Each vm/project file has YAML frontmatter (type, name, last_updated as YYYY-MM-DD, ...) and sections such as Purpose, Deployed, Config Notes, Recent Changes.

Rules:
- NEVER write secret values (passwords, tokens, API keys, private keys, connection strings with passwords). Refer to env var NAMES and where they are stored instead.
- If you are not sure which VM or project a change belongs to, append a line to inbox.md instead of guessing.
- Keep entries short, factual and in the past tense. Use today's date given by the user message.
- You cannot run commands or touch files. To propose a change, include the COMPLETE new content of each changed file in a block exactly like:
<mochi-edit path="vms/example.md">
...entire new file content...
</mochi-edit>
  The user reviews every block as a diff before anything is saved. Propose edits only to files under vms/, projects/, changelog/ and inbox.md. When you change a vm or project file also add a line to the current month's changelog and update last_updated.
- For questions, just answer from the files. If the answer is not in them, say so.`;
