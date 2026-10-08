import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ writeOpsFiles: vi.fn() }));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, ...api };
});

import { HAPPY_MS, QuickAdd } from "./QuickAdd";
import { buildOpsData } from "../../lib/ops/useOpsMemory";

const VM = "---\ntype: vm\nname: prod-api-01\nlast_updated: 2026-09-01\n---\n\n## Recent Changes\n- old\n";
const FILES = [
  { path: "vms/prod-api-01.md", content: VM },
  { path: "projects/nexus-ai.md", content: "---\ntype: project\nname: nexus-ai\n---\n" },
];

function setup(onSaved = vi.fn()) {
  const data = buildOpsData(FILES);
  render(<QuickAdd files={data.files} entries={data.entries} onSaved={onSaved} today="2026-10-08" />);
  return { onSaved };
}
const note = () => screen.getByLabelText("Note") as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(note(), { target: { value: text } });

beforeEach(() => {
  api.writeOpsFiles.mockReset().mockResolvedValue({ status: "saved", commit: "abc1234" });
});
afterEach(() => vi.useRealTimers());

describe("QuickAdd", () => {
  it("disables saving until a note and a valid name are entered", () => {
    setup();
    const save = () => screen.getByRole("button", { name: "Log change" });
    expect(save()).toBeDisabled();
    type("Upgraded nginx");
    expect(save()).toBeDisabled(); // no target name yet
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "prod-api-01" } });
    expect(save()).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "bad name!" } });
    expect(save()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Names may only contain");
  });

  it("offers existing names for autocomplete", () => {
    setup();
    expect(document.querySelectorAll("#quick-add-names option")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Target type"), { target: { value: "project" } });
    expect(document.querySelector("#quick-add-names option")?.getAttribute("value")).toBe("nexus-ai");
  });

  it("says when a new file will be created from the template", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "staging-01" } });
    expect(screen.getByTestId("creating")).toHaveTextContent("Will create vms/staging-01.md from the template.");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "prod-api-01" } });
    expect(screen.queryByTestId("creating")).toBeNull();
  });

  it("saves one batch (one commit) with changelog, target and index", async () => {
    const { onSaved } = setup();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "prod-api-01" } });
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "upgrade" } });
    type("Upgraded nginx to 1.27");
    fireEvent.click(screen.getByRole("button", { name: "Log change" }));

    await waitFor(() => expect(api.writeOpsFiles).toHaveBeenCalledTimes(1));
    const [edits, message] = api.writeOpsFiles.mock.calls[0];
    expect((edits as { path: string }[]).map((e) => e.path).sort()).toEqual([
      "INDEX.md",
      "changelog/2026-10.md",
      "vms/prod-api-01.md",
    ]);
    expect(message).toBe("log prod-api-01: Upgraded nginx to 1.27");
    expect(edits.find((e: { path: string }) => e.path === "changelog/2026-10.md").content).toContain("tag: upgrade");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("saves on Ctrl+Enter and on Cmd+Enter, clears the note, and shows the happy mascot briefly", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Target type"), { target: { value: "inbox" } });
    type("first");
    fireEvent.keyDown(note(), { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(api.writeOpsFiles).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(note().value).toBe(""));
    expect(screen.getByRole("img")).toHaveAttribute("data-state", "happy");

    type("second");
    fireEvent.keyDown(note(), { key: "Enter", metaKey: true });
    await waitFor(() => expect(api.writeOpsFiles).toHaveBeenCalledTimes(2));
  });

  it("plain Enter does not save", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Target type"), { target: { value: "inbox" } });
    type("hello");
    fireEvent.keyDown(note(), { key: "Enter" });
    expect(api.writeOpsFiles).not.toHaveBeenCalled();
  });

  it("returns the mascot to idle after the happy moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    fireEvent.change(screen.getByLabelText("Target type"), { target: { value: "inbox" } });
    type("note");
    fireEvent.click(screen.getByRole("button", { name: "Add to inbox" }));
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("data-state", "happy"));
    await act(async () => {
      vi.advanceTimersByTime(HAPPY_MS + 50);
    });
    expect(screen.getByRole("img")).toHaveAttribute("data-state", "idle");
  });

  it("without a target writes only inbox.md", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Target type"), { target: { value: "inbox" } });
    expect(screen.queryByLabelText("Name")).toBeNull();
    type("Look at disk usage");
    fireEvent.click(screen.getByRole("button", { name: "Add to inbox" }));
    await waitFor(() => expect(api.writeOpsFiles).toHaveBeenCalled());
    const [edits] = api.writeOpsFiles.mock.calls[0];
    expect(edits).toHaveLength(1);
    expect(edits[0].path).toBe("inbox.md");
  });

  it("keeps the note and shows redacted findings when blocked", async () => {
    api.writeOpsFiles.mockResolvedValue({
      status: "blocked",
      findings: [{ kind: "credential_assignment", line: 5, preview: "inbox.md: password=Sup… (11 chars)" }],
    });
    const { onSaved } = setup();
    fireEvent.change(screen.getByLabelText("Target type"), { target: { value: "inbox" } });
    type("password=SuperSecret1");
    fireEvent.click(screen.getByRole("button", { name: "Add to inbox" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("contains secrets");
    expect(alert).not.toHaveTextContent("SuperSecret1");
    expect(note().value).toBe("password=SuperSecret1");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("shows backend errors", async () => {
    api.writeOpsFiles.mockRejectedValue("Ops Memory is not set up yet.");
    setup();
    fireEvent.change(screen.getByLabelText("Target type"), { target: { value: "inbox" } });
    type("x");
    fireEvent.click(screen.getByRole("button", { name: "Add to inbox" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not set up");
    expect(note().value).toBe("x");
  });
});
