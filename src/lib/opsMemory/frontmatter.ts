import { parse as parseYaml } from "yaml";
import type { Eol, FrontmatterData, MarkdownDoc } from "./types";

export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterError";
  }
}

const OPEN_RE = /^---[ \t]*\r?\n$/;
const CLOSE_RE = /^---[ \t]*(\r?\n)?$/;

function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function detectEol(text: string): Eol {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > 0 && crlf >= lf ? "\r\n" : "\n";
}

/**
 * Split markdown into frontmatter and body without losing a single byte.
 * Text without a well-formed `---` block is returned as body only.
 */
export function parseMarkdown(text: string): MarkdownDoc {
  const eol = detectEol(text);
  const noFrontmatter: MarkdownDoc = { open: "", frontmatter: "", close: "", body: text, eol };

  const bom = text.startsWith("﻿") ? "﻿" : "";
  const lines = splitLines(text.slice(bom.length));
  if (lines.length === 0 || !OPEN_RE.test(lines[0])) return noFrontmatter;

  const closeIdx = lines.findIndex((l, i) => i > 0 && CLOSE_RE.test(l));
  if (closeIdx === -1) return noFrontmatter;

  return {
    open: bom + lines[0],
    frontmatter: lines.slice(1, closeIdx).join(""),
    close: lines[closeIdx],
    body: lines.slice(closeIdx + 1).join(""),
    eol,
  };
}

/** Inverse of {@link parseMarkdown}. An unmodified document serializes byte-identically. */
export function serializeMarkdown(doc: MarkdownDoc): string {
  return doc.open + doc.frontmatter + doc.close + doc.body;
}

export function hasFrontmatter(doc: MarkdownDoc): boolean {
  return doc.open !== "";
}

/** Parse the YAML frontmatter into a plain object. Throws {@link FrontmatterError} if invalid. */
export function readFrontmatter(doc: MarkdownDoc): FrontmatterData {
  if (doc.frontmatter.trim() === "") return {};
  let value: unknown;
  try {
    value = parseYaml(doc.frontmatter);
  } catch (e) {
    throw new FrontmatterError(`Invalid YAML frontmatter: ${(e as Error).message.split("\n")[0]}`);
  }
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new FrontmatterError("Frontmatter must be a YAML mapping");
  }
  return value as FrontmatterData;
}

// ---------------------------------------------------------------- editing

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatScalar(v: string | number | boolean | null, inFlow: boolean): string {
  if (v === null) return "null";
  if (typeof v !== "string") return String(v);
  const roundTrips = (src: string): boolean => {
    try {
      return inFlow ? (parseYaml(`[${src}]`) as unknown[])[0] === v : parseYaml(`k: ${src}`)?.k === v;
    } catch {
      return false;
    }
  };
  if (v !== "" && !/[\r\n]/.test(v) && v === v.trim() && roundTrips(v)) return v;
  return JSON.stringify(v);
}

/** Format a value as a single-line YAML scalar or flow sequence. */
export function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (item !== null && typeof item === "object") throw new FrontmatterError("Nested values are not supported");
      return formatScalar(item as string | number | boolean | null, true);
    });
    return `[${items.join(", ")}]`;
  }
  if (value !== null && typeof value === "object") throw new FrontmatterError("Nested values are not supported");
  return formatScalar(value as string | number | boolean | null, false);
}

interface KeySpan {
  start: number;
  end: number; // exclusive
}

function findKey(lines: string[], key: string): KeySpan | undefined {
  const keyRe = new RegExp(`^${escapeRegExp(key)}[ \\t]*:(?:[ \\t]|\\r?\\n|$)`);
  const start = lines.findIndex((l) => keyRe.test(l));
  if (start === -1) return undefined;
  let end = start + 1;
  while (end < lines.length && /^([ \t]+\S|-[ \t])/.test(lines[end])) end++;
  return { start, end };
}

/** Return a copy of `doc` with top-level `key` set. Other lines, comments and the body are untouched. */
export function setField(doc: MarkdownDoc, key: string, value: unknown): MarkdownDoc {
  if (!/^[A-Za-z_][\w-]*$/.test(key)) throw new FrontmatterError(`Invalid frontmatter key: ${key}`);
  const formatted = formatValue(value);

  if (!hasFrontmatter(doc)) {
    return { ...doc, open: `---${doc.eol}`, frontmatter: `${key}: ${formatted}${doc.eol}`, close: `---${doc.eol}` };
  }

  const lines = splitLines(doc.frontmatter);
  const span = findKey(lines, key);
  if (!span) {
    const last = lines[lines.length - 1];
    const needsEol = last !== undefined && !last.endsWith("\n");
    return { ...doc, frontmatter: doc.frontmatter + (needsEol ? doc.eol : "") + `${key}: ${formatted}${doc.eol}` };
  }

  const old = lines[span.start];
  const lineEol = old.endsWith("\r\n") ? "\r\n" : old.endsWith("\n") ? "\n" : "";
  const afterColon = old.slice(old.indexOf(":") + 1).replace(/\r?\n$/, "");
  // Keep a trailing comment only when the old value is a simple unquoted one.
  const commentMatch = span.end === span.start + 1 && !/["']/.test(afterColon) ? afterColon.match(/\s+#.*$/) : null;
  const next = `${key}: ${formatted}${commentMatch ? commentMatch[0] : ""}${lineEol}`;
  const out = [...lines.slice(0, span.start), next, ...lines.slice(span.end)];
  return { ...doc, frontmatter: out.join("") };
}

/** Return a copy of `doc` without top-level `key` (no-op if absent). */
export function removeField(doc: MarkdownDoc, key: string): MarkdownDoc {
  const lines = splitLines(doc.frontmatter);
  const span = findKey(lines, key);
  if (!span) return doc;
  return { ...doc, frontmatter: [...lines.slice(0, span.start), ...lines.slice(span.end)].join("") };
}
