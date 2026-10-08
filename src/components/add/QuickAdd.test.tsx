import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ writeOpsFiles: vi.fn(), secretSet: vi.fn() }));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, ...api };
});

import { HAPPY_MS, QuickAdd } from "./QuickAdd";

const VM = "---\ntype: vm\nname: prod-api-01\nlast_updated: 2026-09-01\n---\n\n## Recent Changes\n- old\n";
const FILES = [
  { path: "vms/prod-api-01.md", content: VM },
  { path: "projects/nexus-ai.md", content: "---\ntype: project\nname: nexus-ai\n---\n" },
];

function setup(onSaved = vi.fn()) {
  render(<QuickAdd files={FILES} onSaved={onSaved} today="2026-10-08" />);
  return { onSaved };
}
const note = () => screen.getByLabelText("Note") as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(note(), { target: { value: text } });
/** Pick an option from one of the custom dropdowns. */
function choose(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  fireEvent.click(screen.getByRole("option", { name: option }));
}

beforeEach(() => {
  api.writeOpsFiles.mockReset().mockResolvedValue({ status: "saved", commit: "abc1234" });
  api.secretSet.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("QuickAdd", () => {
  it("disables saving until a note and a valid name are entered", () => {
    setup();
    const save = () => screen.getByRole("button", { name: "Log change" });
    expect(save()).toBeDisabled();
    type("Upgraded nginx");
    expect(save()).toBeDisabled(); // no target name yet
    choose("Name", "prod-api-01");
    expect(save()).toBeEnabled();
    choose("Name", /New VM/);
    fireEvent.change(screen.getByLabelText("New name"), { target: { value: "bad name!" } });
    expect(save()).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Names may only contain");
  });

  it("offers existing names in a dropdown, per type", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["prod-api-01", "+ New VM…"]);
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    choose("Target type", "Project");
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(screen.getAllByRole("option")[0]).toHaveTextContent("nexus-ai");
  });

  it("says when a new file will be created from the template", () => {
    setup();
    choose("Name", /New VM/);
    fireEvent.change(screen.getByLabelText("New name"), { target: { value: "staging-01" } });
    expect(screen.getByTestId("creating")).toHaveTextContent("Will create vms/staging-01.md from the template.");
    choose("Name", "prod-api-01");
    expect(screen.queryByTestId("creating")).toBeNull();
  });

  it("saves one batch (one commit) with changelog, target and index", async () => {
    const { onSaved } = setup();
    choose("Name", "prod-api-01");
    choose("Tag", "upgrade");
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
    choose("Target type", /inbox/);
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
    choose("Target type", /inbox/);
    type("hello");
    fireEvent.keyDown(note(), { key: "Enter" });
    expect(api.writeOpsFiles).not.toHaveBeenCalled();
  });

  it("returns the mascot to idle after the happy moment", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    setup();
    choose("Target type", /inbox/);
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
    choose("Target type", /inbox/);
    expect(screen.queryByRole("button", { name: "Name" })).toBeNull();
    expect(screen.queryByLabelText("New name")).toBeNull();
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
    choose("Target type", /inbox/);
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
    choose("Target type", /inbox/);
    type("x");
    fireEvent.click(screen.getByRole("button", { name: "Add to inbox" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not set up");
    expect(note().value).toBe("x");
  });
});

describe("QuickAdd dev login mode", () => {
  const PROJECT =
    "---\nlast_updated: 2026-09-01\n---\n# click-print\n\n## Dev Logins\n\n| Label | URL | Username | Role | Password | Notes |\n|---|---|---|---|---|---|\n| Admin | http://x | admin@x.demo | Admin | keychain | demo |\n";
  const files = [{ path: "projects/click-print.md", content: PROJECT }];

  function loginSetup() {
    const onSaved = vi.fn();
    render(<QuickAdd files={files} onSaved={onSaved} today="2026-10-08" />);
    fireEvent.click(screen.getByRole("button", { name: "Dev login" }));
    choose("Which project", "click-print");
    return { onSaved };
  }
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("saves the row to markdown first, then the password to the keychain", async () => {
    const { onSaved } = loginSetup();
    fill("Label", "Customer");
    fill("Username", "c@x.demo");
    fill("Role", "Customer");
    fill("Password", "Sup3r-secret!");
    fireEvent.click(screen.getByRole("button", { name: "Save login" }));

    await waitFor(() => expect(api.secretSet).toHaveBeenCalledTimes(1));
    expect(api.secretSet).toHaveBeenCalledWith("devlogin:click-print:c@x.demo", "Sup3r-secret!");
    const [edits, message] = api.writeOpsFiles.mock.calls[0];
    expect(JSON.stringify(edits) + message).not.toContain("Sup3r-secret!");
    expect(edits.find((e: { path: string }) => e.path === "projects/click-print.md").content).toContain("| Customer |");
    expect(api.writeOpsFiles.mock.invocationCallOrder[0]).toBeLessThan(api.secretSet.mock.invocationCallOrder[0]);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("status")).toHaveTextContent("keychain");
  });

  it("prefills an existing login and keeps its password when left blank", async () => {
    loginSetup();
    choose("Which login", /Admin/);
    expect((screen.getByLabelText("Username") as HTMLInputElement).value).toBe("admin@x.demo");
    expect(screen.getByLabelText("Password")).toHaveAttribute("placeholder", expect.stringContaining("Leave blank"));
    fill("Role", "Owner");
    fireEvent.click(screen.getByRole("button", { name: "Save login" }));
    await waitFor(() => expect(api.writeOpsFiles).toHaveBeenCalled());
    expect(api.secretSet).not.toHaveBeenCalled();
    const [edits] = api.writeOpsFiles.mock.calls[0];
    expect(edits.find((e: { path: string }) => e.path === "projects/click-print.md").content).toMatch(/\| Owner \| keychain \|/);
  });

  it("never touches the keychain when the files are blocked", async () => {
    api.writeOpsFiles.mockResolvedValueOnce({ status: "blocked", findings: [{ kind: "credential_assignment", line: 1, preview: "x" }] });
    loginSetup();
    fill("Label", "A");
    fill("Username", "a");
    fill("Password", "pw1234");
    fireEvent.click(screen.getByRole("button", { name: "Save login" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("contains secrets");
    expect(api.secretSet).not.toHaveBeenCalled();
  });

  it("tells the user when the details were saved but the keychain failed", async () => {
    api.secretSet.mockRejectedValue("keychain locked");
    const { onSaved } = loginSetup();
    fill("Label", "A");
    fill("Username", "a");
    fill("Password", "pw1234");
    fireEvent.click(screen.getByRole("button", { name: "Save login" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("details were saved, but the password could not be stored");
    expect(onSaved).toHaveBeenCalled();
  });

  it("requires a target, a label and a username", () => {
    render(<QuickAdd files={files} onSaved={() => undefined} today="2026-10-08" />);
    fireEvent.click(screen.getByRole("button", { name: "Dev login" }));
    expect(screen.getByRole("button", { name: "Save login" })).toBeDisabled();
    choose("Which project", "click-print");
    fill("Label", "A");
    expect(screen.getByRole("button", { name: "Save login" })).toBeDisabled();
    fill("Username", "u");
    expect(screen.getByRole("button", { name: "Save login" })).toBeEnabled();
  });
});
