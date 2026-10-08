import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "../../lib/api";

const scan = vi.hoisted(() => ({ scanSecrets: vi.fn() }));
vi.mock("../../lib/secretScanner", async () => {
  const actual = await vi.importActual<typeof import("../../lib/secretScanner")>("../../lib/secretScanner");
  return { ...actual, ...scan };
});

import { Digest } from "./Digest";
import type { ClaudeProvider, SendRequest } from "../../lib/claude/provider";

const FILES = [{ path: "changelog/2026-10.md", content: "# Changelog 2026-10\n\n- 2026-10-08 — Upgraded nginx (vm: prod)\n- 2026-09-01 — Old\n" }];

function provider(events: StreamEvent[], calls: SendRequest[] = []): (k: "cli" | "api") => ClaudeProvider {
  return () => ({
    kind: "api",
    send: async (req, onEvent) => {
      calls.push(req);
      events.forEach(onEvent);
    },
    test: async () => "ok",
  });
}

beforeEach(() => scan.scanSecrets.mockReset().mockResolvedValue([]));

describe("Digest", () => {
  it("is disabled until Claude is connected", () => {
    render(<Digest files={FILES} claudeProvider={null} today="2026-10-08" />);
    expect(screen.getByRole("button", { name: "Weekly digest" })).toBeDisabled();
    expect(screen.getByText(/Connect Claude in Settings/)).toBeInTheDocument();
  });

  it("sends only the last 7 days of changelog lines and shows the result", async () => {
    const calls: SendRequest[] = [];
    render(
      <Digest
        files={FILES}
        claudeProvider="api"
        today="2026-10-08"
        createProvider={provider([{ type: "text", text: "- nginx upgraded on prod" }, { type: "done" }], calls)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Weekly digest" }));
    expect(await screen.findByText("- nginx upgraded on prod")).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0].messages[0].content).toContain("Upgraded nginx");
    expect(calls[0].messages[0].content).not.toContain("Old");
  });

  it("does not call Claude when nothing happened this week", async () => {
    const calls: SendRequest[] = [];
    render(<Digest files={FILES} claudeProvider="api" today="2026-12-01" createProvider={provider([], calls)} />);
    fireEvent.click(screen.getByRole("button", { name: "Weekly digest" }));
    expect(await screen.findByText("No changes were logged in the past 7 days.")).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("strips any edit blocks Claude might add and never applies them", async () => {
    render(
      <Digest
        files={FILES}
        claudeProvider="api"
        today="2026-10-08"
        createProvider={provider([{ type: "text", text: 'Summary.\n<mochi-edit path="inbox.md">\nx\n</mochi-edit>' }, { type: "done" }])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Weekly digest" }));
    expect(await screen.findByText("Summary.")).toBeInTheDocument();
    expect(screen.queryByText(/mochi-edit/)).toBeNull();
  });

  it("refuses to send a changelog that looks like it holds a secret", async () => {
    scan.scanSecrets.mockResolvedValue([{ kind: "api_key", line: 1, preview: "x" }]);
    const calls: SendRequest[] = [];
    render(<Digest files={FILES} claudeProvider="api" today="2026-10-08" createProvider={provider([], calls)} />);
    fireEvent.click(screen.getByRole("button", { name: "Weekly digest" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("contains a secret");
    expect(calls).toHaveLength(0);
  });

  it("shows provider errors", async () => {
    render(
      <Digest
        files={FILES}
        claudeProvider="cli"
        today="2026-10-08"
        createProvider={provider([{ type: "error", message: "Claude Code is not logged in." }])}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Weekly digest" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("not logged in"));
  });
});
