import { diffLines } from "diff";

export interface DiffLine {
  kind: "add" | "remove" | "same";
  text: string;
}

/** Line-based diff between two texts, with one entry per line. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const out: DiffLine[] = [];
  for (const part of diffLines(before, after)) {
    const kind = part.added ? "add" : part.removed ? "remove" : "same";
    const lines = part.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    for (const text of lines) out.push({ kind, text });
  }
  return out;
}

/** True when the diff contains any added or removed line. */
export function hasChanges(diff: DiffLine[]): boolean {
  return diff.some((d) => d.kind !== "same");
}
