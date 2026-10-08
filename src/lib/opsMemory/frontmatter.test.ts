import { describe, expect, it } from "vitest";
import {
  FrontmatterError,
  formatValue,
  hasFrontmatter,
  parseMarkdown,
  readFrontmatter,
  removeField,
  serializeMarkdown,
  setField,
} from "./frontmatter";

const roundTrip = (text: string) => serializeMarkdown(parseMarkdown(text));

const SAMPLE = `---
type: vm
name: prod-api-01
host: 10.0.0.5          # no secrets here
custom_unknown: {a: 1}
tags:
  - one
  - two
last_updated: 2026-10-07
---

## Purpose
Body with --- in it

---
not frontmatter
`;

describe("round trip (byte identical)", () => {
  const cases: Record<string, string> = {
    "typical file": SAMPLE,
    "CRLF line endings": SAMPLE.replace(/\n/g, "\r\n"),
    "mixed line endings": "---\r\na: 1\n---\r\nbody\n",
    BOM: "﻿" + SAMPLE,
    "no frontmatter": "# Just a heading\n\ntext\n",
    "empty file": "",
    "empty frontmatter": "---\n---\nbody\n",
    "no trailing newline": "---\na: 1\n---\nbody",
    "closing delimiter at EOF without newline": "---\na: 1\n---",
    "unterminated frontmatter": "---\na: 1\nbody\n",
    "trailing spaces on delimiters": "---  \na: 1\n--- \nbody\n",
    unicode: "---\nname: café\n---\n日本語 — ✓\n",
    "trailing blank lines": "---\na: 1\n---\n\n\n\n",
  };
  for (const [name, text] of Object.entries(cases)) {
    it(name, () => expect(roundTrip(text)).toBe(text));
  }
});

describe("parseMarkdown", () => {
  it("splits delimiters, frontmatter and body", () => {
    const doc = parseMarkdown("---\na: 1\nb: 2\n---\nbody\n");
    expect(doc.open).toBe("---\n");
    expect(doc.frontmatter).toBe("a: 1\nb: 2\n");
    expect(doc.close).toBe("---\n");
    expect(doc.body).toBe("body\n");
    expect(hasFrontmatter(doc)).toBe(true);
  });

  it("only treats the first block as frontmatter", () => {
    const doc = parseMarkdown("---\na: 1\n---\nx\n---\nb: 2\n---\n");
    expect(doc.frontmatter).toBe("a: 1\n");
    expect(doc.body).toBe("x\n---\nb: 2\n---\n");
  });

  it("detects the dominant line ending", () => {
    expect(parseMarkdown("a\r\nb\r\n").eol).toBe("\r\n");
    expect(parseMarkdown("a\nb\n").eol).toBe("\n");
    expect(parseMarkdown("single").eol).toBe("\n");
  });

  it("treats text that does not start with --- as body only", () => {
    const doc = parseMarkdown("\n---\na: 1\n---\n");
    expect(hasFrontmatter(doc)).toBe(false);
    expect(doc.body).toBe("\n---\na: 1\n---\n");
  });
});

describe("readFrontmatter", () => {
  it("parses known and unknown fields", () => {
    const data = readFrontmatter(parseMarkdown(SAMPLE));
    expect(data.name).toBe("prod-api-01");
    expect(data.host).toBe("10.0.0.5");
    expect(data.custom_unknown).toEqual({ a: 1 });
    expect(data.tags).toEqual(["one", "two"]);
  });

  it("keeps dates as strings", () => {
    expect(readFrontmatter(parseMarkdown(SAMPLE)).last_updated).toBe("2026-10-07");
  });

  it("returns {} when there is no or empty frontmatter", () => {
    expect(readFrontmatter(parseMarkdown("text"))).toEqual({});
    expect(readFrontmatter(parseMarkdown("---\n---\n"))).toEqual({});
  });

  it("throws FrontmatterError on invalid YAML", () => {
    expect(() => readFrontmatter(parseMarkdown("---\na: [unclosed\n---\n"))).toThrow(FrontmatterError);
  });

  it("throws when frontmatter is not a mapping", () => {
    expect(() => readFrontmatter(parseMarkdown("---\n- a\n- b\n---\n"))).toThrow(/mapping/);
  });
});

describe("setField", () => {
  it("replaces an existing value and leaves every other byte alone", () => {
    const doc = setField(parseMarkdown(SAMPLE), "last_updated", "2026-10-08");
    expect(serializeMarkdown(doc)).toBe(SAMPLE.replace("last_updated: 2026-10-07", "last_updated: 2026-10-08"));
  });

  it("preserves a trailing comment on a simple value", () => {
    const out = serializeMarkdown(setField(parseMarkdown(SAMPLE), "host", "10.0.0.9"));
    expect(out).toContain("host: 10.0.0.9          # no secrets here\n");
  });

  it("appends a missing key before the closing delimiter", () => {
    const out = serializeMarkdown(setField(parseMarkdown("---\na: 1\n---\nbody\n"), "b", "two"));
    expect(out).toBe("---\na: 1\nb: two\n---\nbody\n");
  });

  it("uses CRLF when the file uses CRLF", () => {
    const out = serializeMarkdown(setField(parseMarkdown("---\r\na: 1\r\n---\r\nbody\r\n"), "b", "x"));
    expect(out).toBe("---\r\na: 1\r\nb: x\r\n---\r\nbody\r\n");
  });

  it("replaces a multi-line list with a single line", () => {
    const out = serializeMarkdown(setField(parseMarkdown(SAMPLE), "tags", ["x"]));
    expect(out).toContain("tags: [x]\nlast_updated");
    expect(out).not.toContain("- one");
  });

  it("does not touch the body", () => {
    const doc = setField(parseMarkdown(SAMPLE), "name", "other");
    expect(doc.body).toBe(parseMarkdown(SAMPLE).body);
  });

  it("creates frontmatter when there is none", () => {
    const out = serializeMarkdown(setField(parseMarkdown("# Hi\n"), "type", "vm"));
    expect(out).toBe("---\ntype: vm\n---\n# Hi\n");
  });

  it("does not confuse a key with a longer key of the same prefix", () => {
    const out = serializeMarkdown(setField(parseMarkdown("---\nname_long: 1\n---\n"), "name", "x"));
    expect(out).toBe("---\nname_long: 1\nname: x\n---\n");
  });

  it("produces frontmatter that reads back to the same value", () => {
    const tricky = ["a: b", "# not a comment", "true", "null", "123", "  padded ", 'quote"d', "multi\nline", "", "- dash"];
    for (const v of tricky) {
      const doc = setField(parseMarkdown("---\nk: old\n---\n"), "k", v);
      expect(readFrontmatter(doc).k).toBe(v);
    }
  });

  it("rejects invalid keys and nested values", () => {
    const doc = parseMarkdown("---\n---\n");
    expect(() => setField(doc, "bad key", "x")).toThrow(FrontmatterError);
    expect(() => setField(doc, "k", { a: 1 })).toThrow(FrontmatterError);
  });

  it("keeps unknown fields intact", () => {
    const out = serializeMarkdown(setField(parseMarkdown(SAMPLE), "name", "renamed"));
    expect(out).toContain("custom_unknown: {a: 1}\n");
  });
});

describe("removeField", () => {
  it("removes a key and its continuation lines", () => {
    const out = serializeMarkdown(removeField(parseMarkdown(SAMPLE), "tags"));
    expect(out).not.toContain("tags");
    expect(out).not.toContain("- one");
    expect(out).toContain("last_updated: 2026-10-07");
  });

  it("is a no-op for a missing key", () => {
    expect(serializeMarkdown(removeField(parseMarkdown(SAMPLE), "nope"))).toBe(SAMPLE);
  });
});

describe("formatValue", () => {
  it("formats scalars and lists", () => {
    expect(formatValue("hello")).toBe("hello");
    expect(formatValue(3)).toBe("3");
    expect(formatValue(false)).toBe("false");
    expect(formatValue([])).toBe("[]");
    expect(formatValue(["a", "b"])).toBe("[a, b]");
    expect(formatValue(["a, b"])).toBe('["a, b"]');
  });
});
