import { describe, expect, it } from "vitest";
import { loginAccount, parseLogins, upsertLogin } from "./logins";
import { parseRecord } from "./records";
import { planDevLogin } from "./quickAdd";

const FILE = `---
last_updated: 2026-10-07
---
# click-print

## Deployed
- web on :80

## Dev Logins

| Label | URL | Username | Role | Password | Notes |
|---|---|---|---|---|---|
| Admin | http://34.93.253.120 | admin@click2ink.demo | Admin | keychain | Demo data |
| Designer 1 | http://34.93.253.120 | designer1@click2ink.demo | Designer | — | — |

## Recent Changes
- 2026-10-07 — x (by: mochi)
`;

const login = { label: "Admin", url: "http://x", username: "admin@click2ink.demo", role: "Owner", notes: "new", hasPassword: true };

describe("parseLogins", () => {
  it("reads rows and whether a keychain password exists", () => {
    const rows = parseLogins(FILE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ label: "Admin", username: "admin@click2ink.demo", hasPassword: true });
    expect(rows[1].hasPassword).toBe(false);
  });
  it("returns nothing without a section", () => {
    expect(parseLogins("# a\n\n## Deployed\n- x\n")).toEqual([]);
  });
  it("parseRecord moves logins out of the sections", () => {
    const r = parseRecord("projects/click-print.md", FILE);
    expect(r.logins).toHaveLength(2);
    expect(r.sections.map((s) => s.heading)).toEqual(["Deployed", "Recent Changes"]);
  });
});

describe("upsertLogin", () => {
  it("replaces a row with the same label and username, leaving the rest alone", () => {
    const out = upsertLogin(FILE, login);
    expect(parseLogins(out)).toHaveLength(2);
    expect(parseLogins(out)[0]).toMatchObject({ role: "Owner", notes: "new" });
    expect(out.replace(/\| Admin .*\n/, "")).toBe(FILE.replace(/\| Admin .*\n/, ""));
  });
  it("appends a new row", () => {
    const out = upsertLogin(FILE, { ...login, label: "Customer", username: "c@x.demo", hasPassword: false });
    expect(parseLogins(out).map((l) => l.label)).toEqual(["Admin", "Designer 1", "Customer"]);
  });
  it("creates the section and table, with CRLF preserved", () => {
    const out = upsertLogin("---\r\na: 1\r\n---\r\n# p\r\n\r\n## Deployed\r\n- x\r\n", login);
    expect(out).toContain("## Dev Logins");
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(parseLogins(out)).toHaveLength(1);
  });
  it("is idempotent and only ever writes the word keychain", () => {
    const once = upsertLogin(FILE, login);
    expect(upsertLogin(once, login)).toBe(once);
    expect(once).toMatch(/\| keychain \|/);
  });
  it("neutralises pipes and newlines in cells", () => {
    const out = upsertLogin(FILE, { ...login, label: "A|B", notes: "x\ny" });
    expect(parseLogins(out).find((l) => l.label === "A/B")?.notes).toBe("x y");
  });
});

describe("planDevLogin", () => {
  const files = [{ path: "projects/click-print.md", content: FILE }];
  const base = { target: { kind: "project" as const, name: "click-print" }, today: "2026-10-09", files };

  it("edits the file, changelog and index; account is namespaced", () => {
    const plan = planDevLogin({ ...base, login: { label: "Customer", url: "u", username: "c@x.demo", role: "r", notes: "" }, newPassword: true });
    expect(plan.account).toBe(loginAccount("click-print", "c@x.demo"));
    expect(plan.edits.map((e) => e.path).sort()).toEqual(["INDEX.md", "changelog/2026-10.md", "projects/click-print.md"]);
    const project = plan.edits.find((e) => e.path === "projects/click-print.md")!.content;
    expect(project).toContain("last_updated: 2026-10-09");
    expect(parseLogins(project).find((l) => l.label === "Customer")?.hasPassword).toBe(true);
    const log = plan.edits.find((e) => e.path.startsWith("changelog"))!.content;
    expect(log).toContain("dev login added: Customer");
    expect(log).not.toContain("c@x.demo");
  });
  it("keeps an existing keychain flag when no new password is given", () => {
    const plan = planDevLogin({ ...base, login: { label: "Admin", url: "u", username: "admin@click2ink.demo", role: "r", notes: "" }, newPassword: false });
    const project = plan.edits.find((e) => e.path === "projects/click-print.md")!.content;
    expect(parseLogins(project)[0].hasPassword).toBe(true);
    expect(plan.message).toContain("updated");
  });
  it("creates a missing entry from the template and validates input", () => {
    const plan = planDevLogin({ ...base, target: { kind: "vm", name: "new-vm" }, files: [], login: { label: "ssh", url: "", username: "hp", role: "", notes: "" }, newPassword: false });
    expect(plan.edits.some((e) => e.path === "vms/new-vm.md")).toBe(true);
    for (const bad of [{ label: "", username: "a" }, { label: "x", username: "" }, { label: "x", username: "a b" }, { label: "x", username: "a:b" }]) {
      expect(() => planDevLogin({ ...base, login: { url: "", role: "", notes: "", ...bad }, newPassword: false })).toThrow();
    }
  });
});
