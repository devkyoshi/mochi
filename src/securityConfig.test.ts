import { describe, expect, it } from "vitest";
import conf from "../src-tauri/tauri.conf.json";
import capability from "../src-tauri/capabilities/default.json";
import cargoToml from "../src-tauri/Cargo.toml?raw";
import indexHtml from "../index.html?raw";

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name, values];
      }),
  );
}

describe("Content Security Policy", () => {
  const prod = directives(conf.app.security.csp as string);
  const dev = directives(conf.app.security.devCsp as string);

  it("is set (not null) for production and development", () => {
    expect(conf.app.security.csp).toBeTruthy();
    expect(conf.app.security.devCsp).toBeTruthy();
  });

  it("only allows own scripts in production: no inline, eval or remote scripts", () => {
    expect(prod["script-src"]).toEqual(["'self'"]);
    expect(prod["default-src"]).toEqual(["'self'"]);
  });

  it("blocks plugins, base tag changes, form posts and framing", () => {
    for (const csp of [prod, dev]) {
      expect(csp["object-src"]).toEqual(["'none'"]);
      expect(csp["base-uri"]).toEqual(["'none'"]);
      expect(csp["form-action"]).toEqual(["'none'"]);
      expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    }
  });

  it("never allows eval, wildcards or remote hosts for scripts, images, fonts or connections", () => {
    for (const csp of [prod, dev]) {
      for (const [name, values] of Object.entries(csp)) {
        expect(values, `${name} must not use a wildcard`).not.toContain("*");
        expect(values, `${name} must not allow eval`).not.toContain("'unsafe-eval'");
      }
      for (const name of ["img-src", "font-src", "script-src", "default-src"]) {
        const remote = (csp[name] ?? []).filter((v) => /^(https?|wss?):/i.test(v));
        expect(remote, `${name} has remote sources`).toEqual([]);
      }
    }
    const remoteConnect = prod["connect-src"].filter((v) => /^(https?|wss?):/i.test(v));
    expect(remoteConnect).toEqual(["http://ipc.localhost"]);
  });

  it("development additionally allows only the local dev server", () => {
    const extra = dev["connect-src"].filter((v) => !prod["connect-src"].includes(v));
    expect(extra.sort()).toEqual(["http://localhost:1420", "ws://localhost:1420"]);
  });

  it("the page itself has no inline scripts or remote resources", () => {
    expect(indexHtml).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>\s*\S/);
    expect(indexHtml).not.toMatch(/(src|href)=["']https?:/i);
  });
});

describe("capabilities (least privilege)", () => {
  it("grants the main window only event listening and the folder picker", () => {
    expect(capability.windows).toEqual(["main"]);
    expect([...capability.permissions].sort()).toEqual(["core:event:allow-listen", "core:event:allow-unlisten", "dialog:allow-open"]);
  });

  it("never grants broad access (fs, shell, http, opener, process, updater, defaults)", () => {
    for (const p of capability.permissions) {
      expect(p).not.toMatch(/^(fs|shell|http|opener|process|updater|os|global-shortcut|autostart):/);
      expect(p).not.toMatch(/:default$/);
      expect(p).not.toMatch(/^core:(window|webview|app|path|resources|menu|tray)/);
    }
  });

  it("does not depend on powerful plugins that are not needed", () => {
    for (const crate of ["tauri-plugin-fs", "tauri-plugin-shell", "tauri-plugin-http", "tauri-plugin-opener", "tauri-plugin-updater"]) {
      expect(cargoToml).not.toContain(crate);
    }
  });
});

describe("bundle", () => {
  it("ships the hook helper as a sidecar and uses a non-.app identifier", () => {
    expect(conf.bundle.externalBin).toEqual(["binaries/mochi-hook"]);
    expect(conf.identifier.endsWith(".app")).toBe(false);
    expect(conf.productName).toBe("Mochi");
  });

  it("builds the hook helper before dev runs and before bundling", () => {
    expect(conf.build.beforeDevCommand).toContain("prepare:hook");
    expect(conf.build.beforeBuildCommand).toContain("prepare:hook:release");
  });
});
