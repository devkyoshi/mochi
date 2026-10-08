import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers: Record<string, () => void> = {};
const api = vi.hoisted(() => ({
  getConfig: vi.fn(),
  setConfig: vi.fn(),
  setDockState: vi.fn(),
  onDockEvent: vi.fn(),
  listOpsFiles: vi.fn(),
  readOpsFile: vi.fn(),
  onOpsChanged: vi.fn(),
  integrationStatus: vi.fn(),
  setLaunchAtLogin: vi.fn(),
}));
vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, ...api };
});

import Dock from "./dock/Dock";
import { DEFAULT_CONFIG } from "../lib/api";

const CONFIG = { ...DEFAULT_CONFIG, setupComplete: true, opsMemoryPath: "D:/ops" };

/** Run axe on the rendered document. Colour contrast needs real layout/CSS, so it is skipped in jsdom. */
async function violations(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 80)).join(" | ")}`);
}

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  api.getConfig.mockReset().mockResolvedValue(CONFIG);
  api.setConfig.mockReset().mockImplementation((c) => Promise.resolve(c));
  api.setDockState.mockReset().mockResolvedValue(undefined);
  api.onDockEvent.mockReset().mockImplementation((event: string, cb: () => void) => {
    handlers[event] = cb;
    return Promise.resolve(() => undefined);
  });
  api.listOpsFiles.mockReset().mockResolvedValue([
    { path: "vms/prod.md", size: 1 },
    { path: "inbox.md", size: 1 },
  ]);
  api.readOpsFile.mockReset().mockImplementation((p: string) =>
    Promise.resolve(p === "inbox.md" ? "# Inbox\n" : "---\ntype: vm\nname: prod\nlast_updated: 2026-08-01\n---\n\n## Purpose\nAPI\n"),
  );
  api.onOpsChanged.mockReset().mockResolvedValue(() => undefined);
  api.integrationStatus.mockReset().mockResolvedValue({ ruleInstalled: false, stopHook: false, sessionEndHook: false, settingsError: null });
  api.setLaunchAtLogin.mockReset().mockResolvedValue(undefined);
});

async function open(tabName?: string) {
  render(<Dock />);
  await act(async () => undefined);
  fireEvent.click(screen.getByRole("button", { name: "Open Mochi" }));
  if (tabName) fireEvent.click(screen.getByRole("tab", { name: tabName }));
  await act(async () => undefined);
}

describe("accessibility (axe, jsdom)", () => {
  it("the collapsed pill has no violations", async () => {
    render(<Dock />);
    await act(async () => undefined);
    expect(await violations()).toEqual([]);
  });

  for (const tab of ["Home", "Browse", "Chat", "Quick add", "Settings"]) {
    it(`the ${tab} tab has no violations`, async () => {
      await open(tab);
      expect(await violations()).toEqual([]);
    });
  }

  it("the Browse editor has no violations", async () => {
    await open("Browse");
    fireEvent.click(await screen.findByRole("button", { name: /prod\.md/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(await violations()).toEqual([]);
  });

  it("the setup wizard has no violations", async () => {
    api.getConfig.mockResolvedValue(DEFAULT_CONFIG);
    render(<Dock />);
    await screen.findByTestId("wizard");
    expect(await violations()).toEqual([]);
  });
});

describe("keyboard", () => {
  it("Escape closes the panel", async () => {
    await open();
    expect(screen.getByTestId("dock")).toHaveAttribute("data-expanded", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("dock")).toHaveAttribute("data-expanded", "false"));
  });

  it("Escape does nothing when already collapsed", async () => {
    render(<Dock />);
    await act(async () => undefined);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("dock")).toHaveAttribute("data-expanded", "false");
  });

  it("every interactive control in Settings is reachable by name", async () => {
    await open("Settings");
    for (const name of [/Collapse when I click elsewhere/, /Start Mochi when I log in/, /Stale after/, /Sleepy after/, /Apply Claude/]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
  });
});

describe("settings", () => {
  it("saves stale days and sleepy minutes", async () => {
    await open("Settings");
    fireEvent.change(screen.getByLabelText(/Stale after/), { target: { value: "14" } });
    await waitFor(() => expect(api.setConfig).toHaveBeenCalledWith({ ...CONFIG, staleDays: 14 }));
  });

  it("launch at login calls the OS first and only then saves the setting", async () => {
    await open("Settings");
    fireEvent.click(screen.getByLabelText(/Start Mochi when I log in/));
    await waitFor(() => expect(api.setLaunchAtLogin).toHaveBeenCalledWith(true));
    await waitFor(() => expect(api.setConfig).toHaveBeenCalledWith({ ...CONFIG, launchAtLogin: true }));
  });

  it("does not save the setting when the OS refuses", async () => {
    api.setLaunchAtLogin.mockRejectedValue("Could not enable launch at login: denied");
    await open("Settings");
    fireEvent.click(screen.getByLabelText(/Start Mochi when I log in/));
    expect(await screen.findByRole("alert")).toHaveTextContent("denied");
    expect(api.setConfig).not.toHaveBeenCalled();
  });

  it("never touches launch at login on its own", async () => {
    await open("Home");
    expect(api.setLaunchAtLogin).not.toHaveBeenCalled();
  });
});

describe("alerts and sleepy pill", () => {
  it("a stale VM makes the collapsed mascot alert, controlled by the configured threshold", async () => {
    api.getConfig.mockResolvedValue({ ...CONFIG, staleDays: 1 });
    render(<Dock />);
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("data-state", "alert"));
  });

  it("the Home tab explains which entries are stale", async () => {
    api.getConfig.mockResolvedValue({ ...CONFIG, staleDays: 1 });
    await open("Home");
    expect(await screen.findByTestId("stale")).toHaveTextContent("Not updated in 1+ days: prod");
  });
});
