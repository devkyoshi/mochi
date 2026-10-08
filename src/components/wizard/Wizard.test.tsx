import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  claudeTest: vi.fn(),
  pickFolder: vi.fn(),
  validateOpsDirectory: vi.fn(),
  setupOpsMemory: vi.fn(),
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, ...api };
});

import { Wizard } from "./Wizard";

beforeEach(() => {
  api.pickFolder.mockReset().mockResolvedValue("D:/work");
  api.validateOpsDirectory.mockReset().mockResolvedValue("D:/work/ops-memory");
  api.setupOpsMemory.mockReset().mockResolvedValue({ path: "D:/work/ops-memory", gitInitialized: true, created: [] });
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));

async function reachDirectoryReady() {
  click("Get started");
  click(/Choose parent folder/);
  await screen.findByText(/Will use: D:\/work\/ops-memory/);
}

describe("Wizard", () => {
  it("starts on the welcome step", () => {
    render(<Wizard onFinish={vi.fn()} />);
    expect(screen.getByText("Hi, I am Mochi")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });

  it("cannot continue from the directory step before a folder is validated", () => {
    render(<Wizard onFinish={vi.fn()} />);
    click("Get started");
    expect(screen.getByRole("button", { name: "Create and continue" })).toBeDisabled();
  });

  it("validates the picked folder and scaffolds it on continue", async () => {
    render(<Wizard onFinish={vi.fn()} />);
    await reachDirectoryReady();
    expect(api.validateOpsDirectory).toHaveBeenCalledWith("D:/work", true);
    click("Create and continue");
    await screen.findByText("Connect Claude");
    expect(api.setupOpsMemory).toHaveBeenCalledWith("D:/work", true);
  });

  it("shows validation errors and keeps continue disabled", async () => {
    api.validateOpsDirectory.mockRejectedValue("That is a system folder. Choose another location.");
    render(<Wizard onFinish={vi.fn()} />);
    click("Get started");
    click(/Choose parent folder/);
    expect(await screen.findByRole("alert")).toHaveTextContent("system folder");
    expect(screen.getByRole("button", { name: "Create and continue" })).toBeDisabled();
  });

  it("does nothing when the picker is cancelled", async () => {
    api.pickFolder.mockResolvedValue(null);
    render(<Wizard onFinish={vi.fn()} />);
    click("Get started");
    click(/Choose parent folder/);
    await waitFor(() => expect(api.pickFolder).toHaveBeenCalled());
    expect(api.validateOpsDirectory).not.toHaveBeenCalled();
    expect(screen.getByText("Nothing chosen yet")).toBeInTheDocument();
  });

  it("uses the chosen folder as-is in existing mode", async () => {
    api.validateOpsDirectory.mockResolvedValue("D:/work");
    render(<Wizard onFinish={vi.fn()} />);
    click("Get started");
    fireEvent.click(screen.getByLabelText("Use an existing folder"));
    click(/Choose folder/);
    await screen.findByText("Will use: D:/work");
    expect(api.validateOpsDirectory).toHaveBeenCalledWith("D:/work", false);
  });

  it("shows scaffold errors", async () => {
    api.setupOpsMemory.mockRejectedValue("Could not run git");
    render(<Wizard onFinish={vi.fn()} />);
    await reachDirectoryReady();
    click("Create and continue");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not run git");
  });

  it("walks through every step and saves the setup", async () => {
    const onFinish = vi.fn().mockResolvedValue(null);
    render(<Wizard onFinish={onFinish} />);
    await reachDirectoryReady();
    click("Create and continue");
    await screen.findByText("Connect Claude");
    click("Next");
    expect(screen.getByText("Keep notes up to date automatically")).toBeInTheDocument();
    click("Next");
    fireEvent.change(screen.getByLabelText("Shortcut"), { target: { value: "Alt+M" } });
    fireEvent.click(screen.getByLabelText("Mascot sounds"));
    click("Next");
    expect(screen.getByText("All set")).toBeInTheDocument();
    click("Finish");
    await waitFor(() =>
      expect(onFinish).toHaveBeenCalledWith({
        opsMemoryPath: "D:/work/ops-memory",
        hotkey: "Alt+M",
        autoCollapse: true,
        sound: false,
        claudeProvider: null,
        setupComplete: true,
      }),
    );
  });

  it("lets the user connect Claude in the wizard and saves the provider", async () => {
    api.claudeTest.mockResolvedValue("ok");
    const onFinish = vi.fn().mockResolvedValue(null);
    render(<Wizard onFinish={onFinish} />);
    await reachDirectoryReady();
    click("Create and continue");
    await screen.findByText("Connect Claude");
    click("Test connection");
    await screen.findByText("Connected");
    click("Next");
    click("Next");
    click("Next");
    click("Finish");
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith(expect.objectContaining({ claudeProvider: "cli" })));
  });

  it("blocks an empty shortcut", async () => {
    render(<Wizard onFinish={vi.fn()} />);
    await reachDirectoryReady();
    click("Create and continue");
    await screen.findByText("Connect Claude");
    click("Next");
    click("Next");
    fireEvent.change(screen.getByLabelText("Shortcut"), { target: { value: " " } });
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("shows an error when saving fails", async () => {
    const onFinish = vi.fn().mockResolvedValue("Could not register hotkey");
    render(<Wizard onFinish={onFinish} />);
    await reachDirectoryReady();
    click("Create and continue");
    await screen.findByText("Connect Claude");
    click("Next");
    click("Next");
    click("Next");
    click("Finish");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not register hotkey");
  });
});
