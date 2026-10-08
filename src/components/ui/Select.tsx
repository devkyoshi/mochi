import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export interface SelectOption {
  value: string;
  label: string;
  /** Muted second line, e.g. an IP or "Updated 2026-10-08". */
  hint?: string;
}

interface SelectProps {
  /** Accessible name (also used as the listbox name). */
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const TYPEAHEAD_MS = 600;

/**
 * Dark, rounded dropdown that replaces the native `<select>` (whose popup the OS draws in its own
 * light theme). Button + listbox with the usual keyboard support; Escape closes only the list.
 */
export function Select({ label, value, options, onChange, placeholder = "Choose…", className = "" }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();

  const selected = options.find((o) => o.value === value);

  function show() {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function choose(i: number) {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
    button.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active, id]);

  function onButtonKey(e: KeyboardEvent) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      show();
    }
  }

  function onListKey(e: KeyboardEvent) {
    const last = options.length - 1;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopPropagation();
        setOpen(false);
        button.current?.focus();
        return;
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => Math.min(last, a + 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
        return;
      case "Home":
        e.preventDefault();
        setActive(0);
        return;
      case "End":
        e.preventDefault();
        setActive(last);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        return;
      case "Tab":
        setOpen(false);
        return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      const now = e.timeStamp;
      const t = typed.current;
      t.text = now - t.at > TYPEAHEAD_MS ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
      t.at = now;
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(t.text));
      if (hit !== -1) setActive(hit);
    }
  }

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onButtonKey}
        className="flex w-full items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-1.5 text-left text-sm text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-sky-400"
      >
        <span className={`min-w-0 truncate ${selected ? "" : "text-neutral-500"}`}>{selected?.label ?? placeholder}</span>
        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          ref={list}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onListKey}
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-xl bg-neutral-800 p-1 shadow-xl ring-1 ring-white/10 focus:outline-none"
        >
          {options.length === 0 && <li className="px-3 py-2 text-sm text-neutral-500">Nothing to choose yet.</li>}
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(i)}
              className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm ${i === active ? "bg-sky-500/25 text-white" : "text-neutral-200"} ${o.value === value ? "font-medium" : ""}`}
            >
              <span className="block break-words">{o.label}</span>
              {o.hint && <span className="block break-words text-xs text-neutral-400">{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
