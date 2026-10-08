import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ secretGet: vi.fn() }));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, ...api };
});

import { RecordView } from "./RecordView";

const PROJECT = `---
vm: click-print-vm
domain: click2ink.example
live_url: https://click2ink.example
live: true
last_updated: 2026-10-08
---
# click-print

## Storage
- GCS bucket \`click-print-media\` (asia-south1): uploads and media

## Dev Logins

| Label | URL | Username | Role | Password | Notes |
|---|---|---|---|---|---|
| Admin | http://34.93.253.120 | admin@click2ink.demo | Admin | keychain | Demo data |
| Designer | http://34.93.253.120 | designer1@click2ink.demo | Designer | — | — |
`;

const writeText = vi.fn();

beforeEach(() => {
  api.secretGet.mockReset().mockResolvedValue("hunter-two");
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

describe("RecordView live site, storage and dev logins", () => {
  it("shows the website status, storage cards and logins", () => {
    render(<RecordView path="projects/click-print.md" content={PROJECT} />);
    const live = screen.getByTestId("live-site");
    expect(live).toHaveTextContent("Live");
    expect(live).toHaveTextContent("click2ink.example");
    expect(screen.getByText("Storage")).toBeInTheDocument();
    expect(screen.getByText("GCS bucket")).toBeInTheDocument();
    expect(screen.getByText("Dev logins")).toBeInTheDocument();
    expect(screen.getByText("admin@click2ink.demo")).toBeInTheDocument();
  });

  it("marks a site that is not live", () => {
    render(<RecordView path="projects/p.md" content={"---\nlive: false\n---\n# p\n"} />);
    expect(screen.getByTestId("live-site")).toHaveTextContent("Not live");
  });

  it("hides passwords until asked and fetches them from the keychain on demand", async () => {
    render(<RecordView path="projects/click-print.md" content={PROJECT} />);
    expect(api.secretGet).not.toHaveBeenCalled();
    expect(screen.getByTestId("password")).toHaveTextContent("••••••••");
    fireEvent.click(screen.getByRole("button", { name: "Reveal password for Admin" }));
    await waitFor(() => expect(screen.getByTestId("password")).toHaveTextContent("hunter-two"));
    expect(api.secretGet).toHaveBeenCalledWith("devlogin:click-print:admin@click2ink.demo");
    fireEvent.click(screen.getByRole("button", { name: "Hide password for Admin" }));
    expect(screen.getByTestId("password")).toHaveTextContent("••••••••");
  });

  it("copies the password without showing it", async () => {
    render(<RecordView path="projects/click-print.md" content={PROJECT} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy password for Admin" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("hunter-two"));
    expect(screen.getByTestId("password")).toHaveTextContent("••••••••");
    expect(await screen.findByText("Password copied")).toBeInTheDocument();
  });

  it("says when no password is saved and offers no reveal", () => {
    render(<RecordView path="projects/click-print.md" content={PROJECT} />);
    expect(screen.getByText(/No password saved/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reveal password for Designer" })).toBeNull();
  });

  it("shows keychain errors instead of crashing", async () => {
    api.secretGet.mockRejectedValue("No password is stored for this login.");
    render(<RecordView path="projects/click-print.md" content={PROJECT} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal password for Admin" }));
    expect(await screen.findByText("No password is stored for this login.")).toBeInTheDocument();
  });

  it("copies the username", async () => {
    render(<RecordView path="projects/click-print.md" content={PROJECT} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy username for Admin" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("admin@click2ink.demo"));
  });
});
