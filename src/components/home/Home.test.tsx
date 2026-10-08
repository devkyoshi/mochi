import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Home } from "./Home";
import { buildOpsData } from "../../lib/ops/useOpsMemory";

const FILES = [
  { path: "vms/a.md", content: "---\ntype: vm\nname: a\nlast_updated: 2026-10-07\n---\n" },
  { path: "vms/b.md", content: "---\ntype: vm\nname: b\nlast_updated: 2026-08-01\n---\n" },
  { path: "projects/p.md", content: "---\ntype: project\nname: p\nlast_updated: 2026-10-05\n---\n" },
  { path: "vms/broken.md", content: "nothing" },
  { path: "changelog/2026-10.md", content: "# Changelog 2026-10\n\n- 2026-10-07 — Upgraded nginx\n- 2026-10-05 — Deployed p\n" },
];

const base = { loading: false, error: null, externalChange: false, changedPaths: [], onDismissChange: () => undefined, today: "2026-10-08" };

describe("Home", () => {
  it("summarises counts, week changes and stale entries", () => {
    render(<Home data={buildOpsData(FILES)} {...base} />);
    expect(screen.getByTestId("summary")).toHaveTextContent("2 VMs · 1 project · 2 changed this week · 1 stale");
    expect(screen.getByTestId("stale")).toHaveTextContent("b");
  });

  it("lists recent changes newest first", () => {
    render(<Home data={buildOpsData(FILES)} {...base} />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["2026-10-07 Upgraded nginx", "2026-10-05 Deployed p"]);
  });

  it("warns about unreadable files", () => {
    render(<Home data={buildOpsData(FILES)} {...base} />);
    expect(screen.getByTestId("invalid")).toHaveTextContent("1 file could not be read: vms/broken.md");
  });

  it("shows an empty state", () => {
    render(<Home data={buildOpsData([])} {...base} />);
    expect(screen.getByTestId("summary")).toHaveTextContent("0 VMs · 0 projects · 0 changed this week · 0 stale");
    expect(screen.getByText("No changes logged yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("stale")).toBeNull();
  });

  it("shows the external-change banner and lets the user dismiss it", () => {
    const onDismiss = vi.fn();
    render(<Home data={buildOpsData(FILES)} {...base} externalChange changedPaths={["vms/a.md", "inbox.md"]} onDismissChange={onDismiss} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 files were updated outside Mochi.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("uses singular wording for one changed file", () => {
    render(<Home data={buildOpsData(FILES)} {...base} externalChange changedPaths={["vms/a.md"]} />);
    expect(screen.getByRole("status")).toHaveTextContent("1 file was updated outside Mochi.");
  });

  it("shows errors", () => {
    render(<Home data={buildOpsData([])} {...base} error="Ops Memory is not set up yet." />);
    expect(screen.getByRole("alert")).toHaveTextContent("not set up");
  });
});
