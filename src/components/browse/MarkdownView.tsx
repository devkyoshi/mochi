import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseMarkdown, readFrontmatter } from "../../lib/opsMemory";

interface MarkdownViewProps {
  content: string;
}

function scalar(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (v !== null && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function frontmatterFields(doc: ReturnType<typeof parseMarkdown>): [string, unknown][] {
  try {
    return Object.entries(readFrontmatter(doc));
  } catch {
    return [];
  }
}

/**
 * Notes can contain links and images from any source. Inside the app window a link would navigate the
 * webview away from Mochi and an image would fetch a remote URL, so neither is rendered live: links show
 * their text (with the address as a tooltip) and images show their alt text.
 */
const SAFE_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <span className="text-sky-300 underline decoration-dotted" title={href} data-link>
      {children}
    </span>
  ),
  img: ({ alt }) => <span className="text-neutral-500">[image{alt ? `: ${alt}` : ""}]</span>,
};

/** Renders a markdown file: frontmatter as small chips, body as markdown (no raw HTML). */
export function MarkdownView({ content }: MarkdownViewProps) {
  const doc = parseMarkdown(content);
  const fields = frontmatterFields(doc);

  return (
    <article className="prose-mochi space-y-3 text-sm text-neutral-200">
      {fields.length > 0 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-400" data-testid="frontmatter">
          {fields.map(([k, v]) => (
            <div key={k} className="flex gap-1">
              <dt className="text-neutral-500">{k}:</dt>
              <dd>{scalar(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      <Markdown remarkPlugins={[remarkGfm]} components={SAFE_COMPONENTS}>
        {doc.body}
      </Markdown>
    </article>
  );
}
