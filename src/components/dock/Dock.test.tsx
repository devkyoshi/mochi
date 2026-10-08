import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, ...api };
});

import Dock from "./Dock";
import { RELEASE_DELAY_MS, withAutoCollapseSuspended } from "../../lib/dock/autoCollapseGuard";
import { DEFAULT_CONFIG } from "../../lib/api";

const CONFIG = { ...DEFAULT_CONFIG, setupComplete: true };

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  api.getConfig.mockReset().mockResolvedValue(CONFIG);
  api.setConfig.mockReset().mockImplementation((c) => Promise.resolve(c));
  api.setDockState.mockReset().mockResolvedValue(undefined);
  api.integrationStatus.mockReset().mockResolvedValue({ ruleInstalled: false, stopHook: false, sessionEndHook: false, settingsError: null });
  api.listOpsFiles.mockReset().mockResolvedValue([]);
  api.readOpsFile.mockReset().mockResolvedValue("");
  api.onOpsChanged.mockReset().mockImplementation((cb: (p: string[]) => void) => {
    handlers.opsChanged = cb as () => void;
    return Promise.resolve(() => undefined);
  });
  api.onDockEvent.mockReset().mockImplementation((event: string, cb: () => void) => {
    handlers[event] = cb;
    return Promise.resolve(() => undefined);
  });
});

const dock = () => screen.getByTestId("dock");

describe("Dock", () => {
  it("renders collapsed with a pill", async () => {
    render(<Dock />);
    expect(dock()).toHaveAttribute("data-expanded", "false");
    expect(screen.getByRole("button", { name: "Open Mochi" })).toBeInTheDocument();
    await waitFor(() => expect(api.getConfig).toHaveBeenCalled());
  });

  it("expands on click and tells the backend to resize", async () => {
    render(<Dock />);
    fireEvent.click(screen.getByRole("button", { name: "Open Mochi" }));
    expect(dock()).toHaveAttribute("data-expanded", "true");
    expect(screen.getAllByRole("tab").length).toBe(5);
    await waitFor(() => expect(api.setDockState).toHaveBeenCalledWith(true, false));
  });

  it("toggles via the hotkey event and follows the cursor", async () => {
    render(<Dock />);
    await waitFor(() => expect(handlers.toggle).toBeDefined());
    act(() => handlers.toggle());
    expect(dock()).toHaveAttribute("data-expanded", "true");
    await waitFor(() => expect(api.setDockState).toHaveBeenCalledWith(true, true));
    act(() => handlers.toggle());
    expect(dock()).toHaveAttribute("data-expanded", "false");
  });

  it("collapses on blur when auto-collapse is on", async () => {
    render(<Dock />);
    await waitFor(() => expect(handlers.blur).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Open Mochi" }));
    act(() => handlers.blur());
    expect(dock()).toHaveAttribute("data-expanded", "false");
  });

  it("ignores blur while a native dialog (folder picker) is open, then collapses normally again", async () => {
    render(<Dock />);
    await waitFor(() => expect(handlers.blur).toBeDefined());
    await act(async () => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Open Mochi" }));

    let closeDialog: () => void = () => undefined;
    const dialog = withAutoCollapseSuspended(() => new Promise<void>((r) => (closeDialog = r)));
    act(() => handlers.blur()); // the dialog stole focus
    expect(dock()).toHaveAttribute("data-expanded", "true");

    closeDialog();
    await dialog;
    act(() => handlers.blur()); // focus change right after closing is still part of the dialog
    expect(dock()).toHaveAttribute("data-expanded", "true");

    await new Promise((r) => setTimeout(r, RELEASE_DELAY_MS + 50));
    act(() => handlers.blur());
    expect(dock()).toHaveAttribute("data-expanded", "false");
  });

  it("never collapses on blur during first-run setup, so the wizard keeps its progress", async () => {
    api.getConfig.mockResolvedValue(DEFAULT_CONFIG); // setup not complete
    render(<Dock />);
    await screen.findByTestId("wizard");
    fireEvent.click(screen.getByRole("button", { name: "Get started" })); // now on the folder step
    expect(screen.getByText("Where should the notes live?")).toBeInTheDocument();

    act(() => handlers.blur());
    expect(dock()).toHaveAttribute("data-expanded", "true");
    expect(screen.getByText("Where should the notes live?")).toBeInTheDocument();
  });

  it("stays open on blur when auto-collapse is off", async () => {
    api.getConfig.mockResolvedValue({ ...CONFIG, autoCollapse: false });
    render(<Dock />);
    await waitFor(() => expect(handlers.blur).toBeDefined());
    await waitFor(() => expect(api.getConfig).toHaveBeenCalled());
    await act(async () => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Open Mochi" }));
    act(() => handlers.blur());
    expect(dock()).toHaveAttribute("data-expanded", "true");
  });

  it("switches tabs", () => {
    render(<Dock />);
    fireEvent.click(screen.getByRole("button", { name: "Open Mochi" }));
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Claude is not connected yet.")).toBeInTheDocument();
  });

  it("saves the sound toggle", async () => {
    render(<Dock />);
    await act(async () => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Open Mochi" }));
    fireEvent.click(screen.getByRole("button", { name: "Mute sounds" }));
    await waitFor(() => expect(api.setConfig).toHaveBeenCalledWith({ ...CONFIG, sound: false }));
    expect(await screen.findByRole("button", { name: "Unmute sounds" })).toBeInTheDocument();
  });

  it("shows an error when saving settings fails", async () => {
    api.setConfig.mockRejectedValue("Invalid hotkey");
    render(<Dock />);
    fireEvent.click(screen.getByRole("button", { name: "Open Mochi" }));
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByLabelText(/Collapse when I click elsewhere/));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid hotkey");
  });
  it("opens straight into the setup wizard on first run", async () => {
    api.getConfig.mockResolvedValue(DEFAULT_CONFIG);
    render(<Dock />);
    expect(await screen.findByTestId("wizard")).toBeInTheDocument();
    expect(dock()).toHaveAttribute("data-expanded", "true");
  });

  it("shows the new-change mascot in the pill after an external edit", async () => {
    render(<Dock />);
    await waitFor(() => expect(handlers.opsChanged).toBeDefined());
    expect(screen.getByRole("img")).toHaveAttribute("data-state", "idle");
    act(() => (handlers.opsChanged as unknown as (p: string[]) => void)(["vms/a.md"]));
    expect(screen.getByRole("img")).toHaveAttribute("data-state", "new-change");
  });

  it("shows the alert mascot when a hook left a review stub in the inbox", async () => {
    api.listOpsFiles.mockResolvedValue([{ path: "inbox.md", size: 1 }]);
    api.readOpsFile.mockResolvedValue(
      "# Inbox\n- 2026-10-08 — Review needed: infra commands (ssh) ran in project x (cwd: /x) but Ops Memory was not updated (by: mochi-hook)\n",
    );
    render(<Dock />);
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("data-state", "alert"));
  });

  it("does not show the wizard before the config has loaded", () => {
    api.getConfig.mockReturnValue(new Promise(() => undefined));
    render(<Dock />);
    expect(screen.queryByTestId("wizard")).toBeNull();
  });

  it("re-runs setup from settings", async () => {
    render(<Dock />);
    await waitFor(() => expect(api.getConfig).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Open Mochi" }));
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Re-run setup" }));
    await waitFor(() => expect(api.setConfig).toHaveBeenCalledWith({ ...CONFIG, setupComplete: false }));
    expect(await screen.findByTestId("wizard")).toBeInTheDocument();
  });
});
