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
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, ...api };
});

import Dock from "./Dock";
import { DEFAULT_CONFIG } from "../../lib/api";

const CONFIG = { ...DEFAULT_CONFIG, setupComplete: true };

beforeEach(() => {
  for (const k of Object.keys(handlers)) delete handlers[k];
  api.getConfig.mockReset().mockResolvedValue(CONFIG);
  api.setConfig.mockReset().mockImplementation((c) => Promise.resolve(c));
  api.setDockState.mockReset().mockResolvedValue(undefined);
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
