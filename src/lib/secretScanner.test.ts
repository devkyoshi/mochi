import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { describeFindings, scanSecrets, type SecretFinding } from "./secretScanner";

beforeEach(() => {
  invoke.mockReset();
});

describe("scanSecrets", () => {
  it("calls the scan_secrets command with the text and returns findings", async () => {
    const findings: SecretFinding[] = [{ kind: "api_key", line: 2, preview: "sk-… (43 chars)" }];
    invoke.mockResolvedValue(findings);
    await expect(scanSecrets("hello")).resolves.toEqual(findings);
    expect(invoke).toHaveBeenCalledWith("scan_secrets", { text: "hello" });
  });

  it("propagates errors from the backend", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("boom")));
    await expect(scanSecrets("x")).rejects.toThrow("boom");
  });
});

describe("describeFindings", () => {
  it("renders one readable line per finding", () => {
    const lines = describeFindings([
      { kind: "credential_assignment", line: 3, preview: "DB_PASSWORD=Sup… (17 chars)" },
      { kind: "private_key", line: 9, preview: "-----BEGIN PRIVATE KEY-----" },
    ]);
    expect(lines).toEqual([
      "Line 3: credential value (DB_PASSWORD=Sup… (17 chars))",
      "Line 9: private key (-----BEGIN PRIVATE KEY-----)",
    ]);
  });

  it("returns an empty list for no findings", () => {
    expect(describeFindings([])).toEqual([]);
  });
});
