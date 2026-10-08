import { useMemo } from "react";
import { parseInbox } from "../../lib/opsMemory";
import { Badge, Inline } from "../browse/RecordView";

interface InboxProps {
  files: { path: string; content: string }[];
}

/** Readable list of inbox.md notes and review stubs, newest first. */
export function Inbox({ files }: InboxProps) {
  const content = files.find((f) => f.path === "inbox.md")?.content ?? "";
  const items = useMemo(() => parseInbox(content), [content]);
  const reviews = items.filter((i) => i.kind === "review").length;

  return (
    <div className="space-y-3 text-sm" data-testid="inbox">
      <p className="text-base text-white">
        {items.length} {items.length === 1 ? "item" : "items"}
        {reviews > 0 && <span className="text-amber-300"> · {reviews} need review</span>}
      </p>
      {items.length === 0 ? (
        <p className="text-neutral-500">Inbox is empty.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li
              key={i}
              data-kind={it.kind}
              className={`select-text rounded-2xl px-4 py-3 ${it.kind === "review" ? "bg-amber-500/10 ring-1 ring-amber-400/30" : "bg-white/5"}`}
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <span>{it.date}</span>
                {it.kind === "review" && <Badge tone="amber">Needs review</Badge>}
                {it.project && <Badge tone="sky">{it.project}</Badge>}
                {it.author && it.kind !== "review" && <span>{it.author}</span>}
              </div>
              <p className="break-words text-neutral-200">
                <Inline text={it.text} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
