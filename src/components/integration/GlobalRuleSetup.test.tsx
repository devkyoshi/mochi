import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  integrationStatus: vi.fn(),
  integrationPreview: vi.fn(),
  integrationInstall: vi.fn(),
  integrationUninstall: vi.fn(),
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, ...api };
});

import { GlobalRuleSetup } from "./GlobalRuleSetup";
import { countReviewStubs } from "../../lib/opsMemory";

const NONE = { ruleInstalled: false, stopHook: false, sessionEndHook: false, settingsError: null };
const ALL = { ruleInstalled: true, stopHook: true, sessionEndHook: true, settingsError: null };
const PLAN = {
  settingsPath: "C:/Users/me/.claude/settings.json",
  claudeMdPath: "C:/Users/me/.claude/CLAUDE.md",
  settingsBefore: "{}\n",
  settingsAfter: '{\n  "hooks": {}\n}\n',
  claudeMdBefore: "# mine\n",
  claudeMdAfter: "# mine\n\n<!-- MOCHI:BEGIN -->\nrule\n<!-- MOCHI:END -->\n",
  unchanged: false,
};

beforeEach(() => {
  api.integrationStatus.mockReset().mockResolvedValue(NONE);
  api.integrationPreview.mockReset().mockResolvedValue(PLAN);
  api.integrationInstall.mockReset().mockResolvedValue({ backups: ["a.bak", "b.bak"], status: ALL });
  api.integrationUninstall.mockReset().mockResolvedValue({ backups: ["c.bak"], status: NONE });
});

describe("GlobalRuleSetup", () => {
  it("starts by saying nothing has been changed and writes nothing on mount", async () => {
    render(<GlobalRuleSetup opsPath="D:/ops" />);
    expect(await screen.findByTestId("integration-status")).toHaveTextContent("Not installed. Nothing on your machine has been changed.");
    expect(api.integrationInstall).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Preview removal" })).toBeNull();
  });

  it("shows a dry-run diff of both files and requires consent before installing", async () => {
    render(<GlobalRuleSetup opsPath="D:/ops" />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview changes" }));
    expect(api.integrationPreview).toHaveBeenCalledWith(false, "D:/ops");

    const md = await screen.findByLabelText("Changes to ~/.claude/CLAUDE.md");
    expect(md.querySelectorAll('[data-kind="add"]').length).toBeGreaterThan(1);
    expect(md).toHaveTextContent("<!-- MOCHI:BEGIN -->");
    expect(screen.getByLabelText("Changes to ~/.claude/settings.json")).toHaveTextContent('"hooks": {}');

    const install = screen.getByRole("button", { name: "Install" });
    expect(install).toBeDisabled();
    fireEvent.click(install);
    expect(api.integrationInstall).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/I agree to these changes/));
    expect(install).toBeEnabled();
    fireEvent.click(install);
    await waitFor(() => expect(api.integrationInstall).toHaveBeenCalledWith("D:/ops"));
    expect(await screen.findByRole("status")).toHaveTextContent("Installed. Backups saved next to your Claude files (2).");
    expect(screen.getByTestId("integration-status")).toHaveTextContent("rule yes, Stop hook yes, SessionEnd hook yes");
  });

  it("cancel leaves everything untouched", async () => {
    render(<GlobalRuleSetup opsPath="D:/ops" />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview changes" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("rule-preview")).toBeNull();
    expect(api.integrationInstall).not.toHaveBeenCalled();
  });

  it("offers update and removal when already installed, with consent for removal", async () => {
    api.integrationStatus.mockResolvedValue(ALL);
    render(<GlobalRuleSetup />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview removal" }));
    expect(api.integrationPreview).toHaveBeenCalledWith(true, undefined);
    fireEvent.click(await screen.findByLabelText(/remove Mochi's entries/));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(api.integrationUninstall).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent("Removed.");
    expect(screen.getByTestId("integration-status")).toHaveTextContent("Not installed");
  });

  it("says when there is nothing to update", async () => {
    api.integrationStatus.mockResolvedValue(ALL);
    api.integrationPreview.mockResolvedValue({ ...PLAN, unchanged: true });
    render(<GlobalRuleSetup opsPath="D:/ops" />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview update" }));
    expect(await screen.findByText("Everything is already up to date.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("shows preview errors and an invalid settings.json warning without installing", async () => {
    api.integrationStatus.mockResolvedValue({ ...NONE, settingsError: "settings.json is not valid JSON (x). Fix it first; Mochi did not change anything." });
    api.integrationPreview.mockRejectedValue("settings.json is not valid JSON");
    render(<GlobalRuleSetup opsPath="D:/ops" />);
    expect(await screen.findByText(/Fix it first/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview changes" }));
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBe(2));
    expect(api.integrationInstall).not.toHaveBeenCalled();
  });

  it("shows install failures", async () => {
    api.integrationInstall.mockRejectedValue("The hook helper (mochi-hook.exe) was not found next to the app.");
    render(<GlobalRuleSetup opsPath="D:/ops" />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview changes" }));
    fireEvent.click(await screen.findByLabelText(/I agree/));
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("hook helper");
  });
});

describe("countReviewStubs", () => {
  it("counts only hook stubs", () => {
    const inbox = "# Inbox\n- a (by: mochi)\n- b (by: mochi-hook)\r\n- c (by: mochi-hook)\n";
    expect(countReviewStubs(inbox)).toBe(2);
    expect(countReviewStubs("")).toBe(0);
  });
});
