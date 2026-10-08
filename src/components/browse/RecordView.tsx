import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "../../lib/api";
import {
  describeItem,
  inlineSegments,
  loginAccount,
  parseRecord,
  type DevLogin,
  type RecordItem,
  type RecordSection,
} from "../../lib/opsMemory";

export function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineSegments(text).map((s, i) =>
        s.code ? (
          <code key={i} className="rounded bg-white/10 px-1 py-0.5 font-mono text-xs text-sky-200">
            {s.text}
          </code>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "amber" | "sky" }) {
  const tones = {
    neutral: "bg-white/10 text-neutral-300",
    amber: "bg-amber-500/20 text-amber-200",
    sky: "bg-sky-500/20 text-sky-200",
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${tones[tone]}`}>{children}</span>;
}

/** A group of links to related entries, e.g. the VM a project runs on. */
export interface RecordLinks {
  label: string;
  kind: "vm" | "project";
  names: string[];
}

interface RecordViewProps {
  path: string;
  content: string;
  links?: RecordLinks[];
  onOpen?: (kind: "vm" | "project", name: string) => void;
}

const KIND_LABEL = { vm: "Virtual machine", project: "Project", changelog: "Changelog", inbox: "Inbox", other: "Note" } as const;

/** Friendlier names for the headings Claude writes into the files. */
const HEADINGS: Record<string, string> = {
  deployed: "What's running",
  "config notes": "Good to know",
  "recent changes": "History",
  changes: "Changes",
  storage: "Storage",
};
const heading = (h: string) => HEADINGS[h.toLowerCase()] ?? h;
const HISTORY_PREVIEW = 3;

function Card({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-2xl bg-white/5 p-4">
      <h4 className="flex items-center gap-2 text-sm font-medium text-white">
        {title}
        {count !== undefined && <span className="text-xs font-normal text-neutral-500">{count}</span>}
      </h4>
      {children}
    </section>
  );
}

function Chips({ ports, urls }: { ports: string[]; urls: string[] }) {
  if (ports.length === 0 && urls.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {ports.map((p) => (
        <span key={p} className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs text-emerald-200">
          port {p.slice(1)}
        </span>
      ))}
      {urls.map((u) => (
        <span key={u} className="select-text break-all rounded-md bg-sky-500/15 px-1.5 py-0.5 font-mono text-xs text-sky-200">
          {u}
        </span>
      ))}
    </div>
  );
}

/** One thing that runs somewhere: name, qualifier, what it does, and its ports/URLs. */
function ServiceCard({ item }: { item: RecordItem }) {
  const d = describeItem(item.text);
  return (
    <li className="rounded-xl bg-white/5 p-3">
      {d.title && <p className="font-medium text-white">{d.title}</p>}
      {d.meta && (
        <p className="mt-0.5 text-xs text-neutral-400">
          <Inline text={d.meta} />
        </p>
      )}
      <p className={`break-words leading-relaxed text-neutral-300 ${d.title ? "mt-1.5" : ""}`}>
        <Inline text={d.body} />
      </p>
      <Chips ports={d.ports} urls={d.urls} />
    </li>
  );
}

function Note({ item }: { item: RecordItem }) {
  const d = describeItem(item.text);
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300/70" />
      <div className="min-w-0 flex-1 leading-relaxed">
        <p className="break-words text-neutral-200">
          {d.title && <span className="font-medium text-white">{d.title}: </span>}
          <Inline text={d.body} />
        </p>
        <Chips ports={d.ports} urls={d.urls} />
      </div>
    </li>
  );
}

function HistoryEntry({ item }: { item: RecordItem }) {
  const [open, setOpen] = useState(false);
  const long = item.text.length > 220;
  return (
    <li className="relative pl-6">
      <span aria-hidden className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-sky-400/80 ring-4 ring-sky-400/10" />
      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        {item.date && <span className="font-medium text-neutral-300">{item.date}</span>}
        {item.tag && <Badge tone="sky">{item.tag}</Badge>}
        {item.author && <span>{item.author}</span>}
      </div>
      <p className={`mt-1 break-words leading-relaxed text-neutral-300 ${long && !open ? "line-clamp-3" : ""}`}>
        <Inline text={item.text} />
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="mt-1 text-xs text-sky-300 hover:underline focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </li>
  );
}

function History({ section }: { section: RecordSection }) {
  const [all, setAll] = useState(false);
  const items = all ? section.items : section.items.slice(0, HISTORY_PREVIEW);
  return (
    <Card title={heading(section.heading)} count={section.items.length}>
      <ul className="space-y-4 border-l border-white/10 pl-1.5">
        {items.map((it, i) => (
          <HistoryEntry key={i} item={it} />
        ))}
      </ul>
      {section.items.length > HISTORY_PREVIEW && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="rounded-full bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-sky-400"
        >
          {all ? "Show fewer" : `Show all ${section.items.length}`}
        </button>
      )}
    </Card>
  );
}

function SectionCard({ section, kind }: { section: RecordSection; kind: string }) {
  const key = section.heading.toLowerCase();
  if (key === "recent changes" || kind === "changelog") return <History section={section} />;
  const paragraphs = section.paragraphs.map((p, i) => (
    <p key={i} className="break-words leading-relaxed text-neutral-300">
      <Inline text={p} />
    </p>
  ));
  if (key === "deployed" || key === "storage") {
    return (
      <Card title={heading(section.heading)} count={section.items.length}>
        {paragraphs}
        <ul className="grid gap-2 sm:grid-cols-2">
          {section.items.map((it, i) => (
            <ServiceCard key={i} item={it} />
          ))}
        </ul>
      </Card>
    );
  }
  return (
    <Card title={heading(section.heading)}>
      {paragraphs}
      <ul className="space-y-2.5">
        {section.items.map((it, i) => (
          <Note key={i} item={it} />
        ))}
      </ul>
    </Card>
  );
}

const RESULT_MS = 10_000;
const smallBtn =
  "rounded-full bg-white/10 px-2.5 py-1 text-xs text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-sky-400";

/** One dev login. The password is only fetched from the OS keychain on an explicit Copy or Reveal. */
function LoginRow({ login, account }: { login: DevLogin; account: string }) {
  const [shown, setShown] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = (message: string) => {
    setNote(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setNote(null);
      setShown(null);
    }, RESULT_MS);
  };

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash(`${what} copied`);
    } catch {
      flash("Could not copy to the clipboard");
    }
  }

  async function password(action: "copy" | "reveal") {
    try {
      const value = await api.secretGet(account);
      if (action === "copy") await copy(value, "Password");
      else {
        setShown(value);
        flash("Hidden again in 10 s");
      }
    } catch (e) {
      flash(String(e));
    }
  }

  return (
    <li className="space-y-1.5 rounded-xl bg-white/5 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-white">{login.label}</p>
        {login.role && login.role !== "—" && <Badge tone="sky">{login.role}</Badge>}
      </div>
      {login.url && login.url !== "—" && <p className="select-text break-all font-mono text-xs text-sky-200">{login.url}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="select-text break-all text-neutral-200">{login.username}</span>
        <button type="button" className={smallBtn} aria-label={`Copy username for ${login.label}`} onClick={() => void copy(login.username, "Username")}>
          Copy
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {login.hasPassword ? (
          <>
            <span className="select-text font-mono text-neutral-200" data-testid="password">
              {shown ?? "••••••••"}
            </span>
            <button type="button" className={smallBtn} aria-label={`Copy password for ${login.label}`} onClick={() => void password("copy")}>
              Copy
            </button>
            <button
              type="button"
              className={smallBtn}
              aria-label={`${shown ? "Hide" : "Reveal"} password for ${login.label}`}
              onClick={() => (shown ? setShown(null) : void password("reveal"))}
            >
              {shown ? "Hide" : "Reveal"}
            </button>
          </>
        ) : (
          <span className="text-xs text-amber-300">No password saved. Add one in Add → Dev login.</span>
        )}
      </div>
      {login.notes && login.notes !== "—" && <p className="break-words text-xs text-neutral-400">{login.notes}</p>}
      {note && (
        <p role="status" className="text-xs text-emerald-300">
          {note}
        </p>
      )}
    </li>
  );
}

/** Readable, card-style view of an Ops Memory file. The markdown itself is never shown. */
export function RecordView({ path, content, links = [], onOpen }: RecordViewProps) {
  const record = useMemo(() => parseRecord(path, content), [path, content]);
  const { meta } = record;
  const linkGroups = links.filter((l) => l.names.length > 0);
  const name = path.split("/").pop()?.replace(/\.md$/, "") ?? path;

  return (
    <article className="select-text space-y-4 text-sm text-neutral-200" data-testid="record">
      <header className="space-y-2 rounded-2xl bg-white/5 p-4">
        <p className="text-xs uppercase tracking-wide text-sky-300">{KIND_LABEL[record.kind]}</p>
        <h3 className="break-words text-xl font-semibold text-white">{record.title}</h3>
        {(meta.lastUpdated || meta.updatedBy) && (
          <p className="text-xs text-neutral-400">
            {meta.lastUpdated && `Updated ${meta.lastUpdated}`}
            {meta.lastUpdated && meta.updatedBy && " · "}
            {meta.updatedBy}
          </p>
        )}
        {(meta.domain || meta.liveUrl || meta.live !== undefined) && (
          <div className="flex flex-wrap items-center gap-2 pt-1" data-testid="live-site">
            <span className="text-xs text-neutral-500">Website</span>
            {meta.live === true && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">Live</span>}
            {meta.live === false && <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-neutral-300">Not live</span>}
            {meta.domain && <span className="select-text break-all text-xs text-white">{meta.domain}</span>}
            {meta.liveUrl && <span className="select-text break-all font-mono text-xs text-sky-200">{meta.liveUrl}</span>}
          </div>
        )}
        {linkGroups.map((g) => (
          <div key={g.label} className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-neutral-500">{g.label}</span>
            {g.names.map((n) =>
              onOpen ? (
                <button
                  key={n}
                  type="button"
                  onClick={() => onOpen(g.kind, n)}
                  className="rounded-full bg-sky-500/20 px-2.5 py-1 text-xs text-sky-100 hover:bg-sky-500/30 focus-visible:outline-2 focus-visible:outline-sky-400"
                >
                  {n} →
                </button>
              ) : (
                <Badge key={n} tone="sky">
                  {n}
                </Badge>
              ),
            )}
          </div>
        ))}
      </header>

      {record.facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="facts">
          {record.facts.map((f) => (
            <div key={f.label} className="rounded-xl bg-white/5 px-3 py-2.5">
              <dt className="text-xs uppercase tracking-wide text-neutral-500">{f.label}</dt>
              <dd className="mt-0.5 break-all font-medium text-white">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {record.summary.map((p, i) => (
        <p key={i} className="break-words px-1 leading-relaxed text-neutral-400">
          <Inline text={p} />
        </p>
      ))}

      {record.sections.map((s) => (
        <SectionCard key={s.heading} section={s} kind={record.kind} />
      ))}

      {record.logins.length > 0 && (
        <Card title="Dev logins" count={record.logins.length}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {record.logins.map((l) => (
              <LoginRow key={`${l.label}|${l.username}`} login={l} account={loginAccount(name, l.username)} />
            ))}
          </ul>
        </Card>
      )}

      {record.sections.length === 0 && record.logins.length === 0 && record.summary.length === 0 && <p className="text-neutral-500">Nothing recorded yet.</p>}
    </article>
  );
}
