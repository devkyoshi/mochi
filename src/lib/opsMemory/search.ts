import MiniSearch from "minisearch";

export interface SearchDoc {
  path: string;
  content: string;
}

export interface SearchHit {
  path: string;
  score: number;
  /** A short excerpt around the first match, or the start of the file. */
  snippet: string;
}

function title(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

/** Build a full-text index over the given files. */
export function buildSearchIndex(docs: SearchDoc[]): MiniSearch<{ id: string; title: string; content: string }> {
  const index = new MiniSearch<{ id: string; title: string; content: string }>({
    fields: ["title", "content"],
    storeFields: ["title"],
    searchOptions: { boost: { title: 3 }, prefix: true, fuzzy: 0.2, combineWith: "AND" },
  });
  index.addAll(docs.map((d) => ({ id: d.path, title: title(d.path), content: d.content })));
  return index;
}

function snippetFor(content: string, terms: string[]): string {
  const lower = content.toLowerCase();
  let at = -1;
  for (const t of terms) {
    at = lower.indexOf(t.toLowerCase());
    if (at >= 0) break;
  }
  const start = Math.max(0, at - 30);
  const text = content.slice(start, start + 100).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + text;
}

/** Search the index. Empty/whitespace queries return no hits. */
export function search(
  index: ReturnType<typeof buildSearchIndex>,
  docs: SearchDoc[],
  query: string,
  limit = 20,
): SearchHit[] {
  if (query.trim() === "") return [];
  const byPath = new Map(docs.map((d) => [d.path, d.content]));
  return index
    .search(query)
    .slice(0, limit)
    .map((r) => ({
      path: r.id as string,
      score: r.score,
      snippet: snippetFor(byPath.get(r.id as string) ?? "", r.queryTerms),
    }));
}
