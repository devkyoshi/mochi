import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "../../lib/api";

const api = vi.hoisted(() => ({
  writeOpsFiles: vi.fn(),
  claudeSaveKey: vi.fn(),
  claudeHasKey: vi.fn(),
  claudeTest: vi.fn(),
}));
const scan = vi.hoisted(() => ({ scanSecrets: vi.fn() }));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, ...api };
});
vi.mock("../../lib/secretScanner", async () => {
  const actual = await vi.importActual<typeof import("../../lib/secretScanner")>("../../lib/secretScanner");
  return { ...actual, ...scan };
});

import { Chat } from "./Chat";
import { ClaudeConnect } from "./ClaudeConnect";
import type { ClaudeProvider, SendRequest } from "../../lib/claude/provider";

const VM = "---\ntype: vm\nname: prod-api-01\nlast_updated: 2026-09-01\n---\n\n## Recent Changes\n- old\n";
const FILES = [
  { path: "vms/prod-api-01.md", content: VM },
  { path: "inbox.md", content: "# Inbox\n" },
];
const NEW_VM = VM.replace("2026-09-01", "2026-10-08").replace("- old", "- 2026-10-08 — Upgraded nginx to 1.27\n- old");
const REPLY = `Logged it.\n<mochi-edit path="vms/prod-api-01.md">\n${NEW_VM}</mochi-edit>`;

function fakeProvider(events: StreamEvent[], calls: SendRequest[] = []): (k: "cli" | "api") => ClaudeProvider {
  return () => ({
    kind: "api",
    send: async (req, onEvent) => {
      calls.push(req);
      events.forEach(onEvent);
    },
    test: async () => "ok",
  });
}
const textEvents = (t: string): StreamEvent[] => [{ type: "text", text: t.slice(0, 10) }, { type: "text", text: t.slice(10) }, { type: "done" }];

function renderChat(props: Partial<React.ComponentProps<typeof Chat>> = {}) {
  const onApplied = vi.fn();
  render(
    <Chat
      files={FILES}
      claudeProvider="api"
      autoApply={false}
      onApplied={onApplied}
      onOpenSettings={vi.fn()}
      today="2026-10-08"
      createProvider={fakeProvider(textEvents(REPLY))}
      {...props}
    />,
  );
  return { onApplied };
}
const ask = (text: string) => {
  fireEvent.change(screen.getByLabelText("Message"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
};

beforeEach(() => {
  api.writeOpsFiles.mockReset().mockResolvedValue({ status: "saved", commit: "abc1234" });
  scan.scanSecrets.mockReset().mockResolvedValue([]);
});

describe("Chat", () => {
  it("asks to connect when no provider is set", () => {
    const onOpenSettings = vi.fn();
    renderChat({ claudeProvider: null, onOpenSettings });
    expect(screen.getByText("Claude is not connected yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it("streams a reply, hides the edit block, and shows a diff awaiting approval", async () => {
    renderChat();
    ask("log that I upgraded nginx on prod-api-01 to 1.27");
    expect(await screen.findByText("Logged it.")).toBeInTheDocument();
    expect(screen.queryByText(/mochi-edit/)).toBeNull();

    const card = await screen.findByTestId("proposals");
    expect(card).toHaveTextContent("vms/prod-api-01.md");
    const added = card.querySelectorAll('[data-kind="add"]');
    expect([...added].map((n) => n.textContent)).toContain("+ - 2026-10-08 — Upgraded nginx to 1.27");
    expect(api.writeOpsFiles).not.toHaveBeenCalled(); // not applied without approval
  });

  it("applies approved edits through the scan -> commit pipeline", async () => {
    const { onApplied } = renderChat();
    ask("log it");
    fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(api.writeOpsFiles).toHaveBeenCalledTimes(1));
    const [edits, message] = api.writeOpsFiles.mock.calls[0];
    expect(edits).toEqual([{ path: "vms/prod-api-01.md", content: NEW_VM }]);
    expect(message).toContain("claude");
    expect(await screen.findByText("Applied and committed.")).toBeInTheDocument();
    expect(onApplied).toHaveBeenCalled();
  });

  it("rejecting leaves everything untouched", async () => {
    renderChat();
    ask("log it");
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    expect(screen.getByText(/Nothing was changed/)).toBeInTheDocument();
    expect(api.writeOpsFiles).not.toHaveBeenCalled();
  });

  it("auto-applies when the setting is on", async () => {
    const { onApplied } = renderChat({ autoApply: true });
    ask("log it");
    expect(await screen.findByText("Applied and committed.")).toBeInTheDocument();
    expect(api.writeOpsFiles).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalled();
  });

  it("shows redacted findings when the pipeline blocks an edit", async () => {
    api.writeOpsFiles.mockResolvedValue({
      status: "blocked",
      findings: [{ kind: "credential_assignment", line: 4, preview: "vms/prod-api-01.md: DB_PASSWORD=Sup… (12 chars)" }],
    });
    const { onApplied } = renderChat();
    ask("log it");
    fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("contains secrets");
    expect(alert).toHaveTextContent("Line 4");
    expect(onApplied).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Apply changes" })).toBeInTheDocument();
  });

  it("drops edits to unsafe paths and to invalid entries, with a note", async () => {
    const bad = `Done.\n<mochi-edit path="../../etc/hosts">\nx\n</mochi-edit>\n<mochi-edit path="vms/prod-api-01.md">\nno frontmatter\n</mochi-edit>`;
    renderChat({ createProvider: fakeProvider(textEvents(bad)) });
    ask("hack");
    expect(await screen.findByText(/Ignored an edit to \.\.\/\.\.\/etc\/hosts: path escapes Ops Memory/)).toBeInTheDocument();
    expect(screen.getByText(/Ignored an edit to vms\/prod-api-01\.md/)).toBeInTheDocument();
    expect(screen.queryByTestId("proposals")).toBeNull();
    expect(api.writeOpsFiles).not.toHaveBeenCalled();
  });

  it("never sends files flagged by the secret scanner and says so", async () => {
    scan.scanSecrets.mockImplementation((text: string) => Promise.resolve(text.includes("# Inbox") ? [{ kind: "api_key", line: 1, preview: "x" }] : []));
    const calls: SendRequest[] = [];
    renderChat({ createProvider: fakeProvider(textEvents("Fine."), calls) });
    ask("what is on prod?");
    await screen.findByText("Fine.");
    expect(calls[0].system).toContain('<file path="vms/prod-api-01.md">');
    expect(calls[0].system).not.toContain('<file path="inbox.md">');
    expect(screen.getByText(/Not sent to Claude.*inbox\.md/)).toBeInTheDocument();
  });

  it("sends the schema prompt, today's date, the files and the conversation history", async () => {
    const calls: SendRequest[] = [];
    renderChat({ createProvider: fakeProvider(textEvents("First answer here."), calls) });
    ask("first question");
    await screen.findByText("First answer here.");
    ask("second question");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].system).toContain("NEVER write secret values");
    expect(calls[0].system).toContain("Today is 2026-10-08.");
    expect(calls[1].messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "first question"],
      ["assistant", "First answer here."],
      ["user", "second question"],
    ]);
  });

  it("shows provider errors and keeps the chat usable", async () => {
    renderChat({ createProvider: fakeProvider([{ type: "error", message: "The API key was rejected. Check the key in Settings." }]) });
    ask("hi");
    expect(await screen.findByRole("alert")).toHaveTextContent("API key was rejected");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled(); // input cleared, can type again
    expect(screen.getByLabelText("Message")).toBeEnabled();
  });

  it("shows the thinking mascot while a reply is running", async () => {
    let finish: () => void = () => undefined;
    const slow: (k: "cli" | "api") => ClaudeProvider = () => ({
      kind: "api",
      send: (_r, onEvent) => new Promise<void>((res) => (finish = () => { onEvent({ type: "done" }); res(); })),
      test: async () => "ok",
    });
    renderChat({ createProvider: slow });
    ask("hi");
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("data-state", "thinking"));
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    finish();
    await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("data-state", "idle"));
  });
});

describe("ClaudeConnect", () => {
  beforeEach(() => {
    api.claudeSaveKey.mockReset().mockResolvedValue(undefined);
    api.claudeHasKey.mockReset().mockResolvedValue(false);
    api.claudeTest.mockReset().mockResolvedValue("ok");
  });

  it("tests the CLI provider and reports success", async () => {
    const onConnected = vi.fn();
    render(<ClaudeConnect connected={null} onConnected={onConnected} />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Connected");
    expect(api.claudeTest).toHaveBeenCalledWith("cli");
    expect(api.claudeSaveKey).not.toHaveBeenCalled();
    expect(onConnected).toHaveBeenCalledWith("cli");
  });

  it("stores the API key in the keychain, clears the field, then tests", async () => {
    const onConnected = vi.fn();
    render(<ClaudeConnect connected={null} onConnected={onConnected} />);
    fireEvent.click(screen.getByLabelText(/Anthropic API key/));
    const input = screen.getByLabelText("API key") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "sk-ant-api03-abcdefghijklmnop" } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("api"));
    expect(api.claudeSaveKey).toHaveBeenCalledWith("sk-ant-api03-abcdefghijklmnop");
    expect(api.claudeTest).toHaveBeenCalledWith("api");
    expect(input.value).toBe("");
  });

  it("asks for a key when none is stored", async () => {
    render(<ClaudeConnect connected={null} onConnected={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Anthropic API key/));
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Paste your API key first.");
    expect(api.claudeTest).not.toHaveBeenCalled();
  });

  it("shows a readable error when the test fails and does not mark it connected", async () => {
    api.claudeTest.mockRejectedValue("Claude Code was not found. Install it, or switch to an API key in Settings.");
    const onConnected = vi.fn();
    render(<ClaudeConnect connected={null} onConnected={onConnected} />);
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Claude Code was not found");
    expect(onConnected).not.toHaveBeenCalled();
  });
});
