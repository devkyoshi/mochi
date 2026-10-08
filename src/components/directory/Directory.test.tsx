import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Directory } from "./Directory";

const FILES = [
  {
    path: "vms/click-print-vm.md",
    content:
      "---\nlast_updated: 2026-10-08\nupdated_by: claude-code\n---\n# click-print-vm\n\nGCP `asia-south1-a`, IP 34.93.253.120.\n\n## Deployed\n- click-print (docker, `/opt/click-print`): `web` on :80\n\n## Recent Changes\n- 2026-10-08: one\n- 2026-10-07: two\n- 2026-10-06: three\n- 2026-10-05: four\n",
  },
  { path: "projects/click-print.md", content: "---\nvm: click-print-vm\n---\n# ClickPrint\n\n## Config Notes\n- Serial CI run\n" },
  { path: "projects/ethronix-labs-ui.md", content: "# ethronix-labs-ui\n\n## Deployed\n- Served on :8080 (http://34.93.253.120:8080)\n" },
];

function setup(kind: "vm" | "project", extra: Partial<Parameters<typeof Directory>[0]> = {}) {
  const onSelect = vi.fn();
  const onOpen = vi.fn();
  render(<Directory kind={kind} files={FILES} onSelect={onSelect} onOpen={onOpen} {...extra} />);
  return { onSelect, onOpen };
}

describe("Directory", () => {
  it("picks a project from a dropdown and shows it as cards", () => {
    const { onSelect } = setup("project");
    const dropdown = screen.getByRole("button", { name: "Choose a project" });
    expect(dropdown).toHaveTextContent("click-print");
    fireEvent.click(dropdown);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    fireEvent.click(screen.getByRole("option", { name: /ethronix-labs-ui/ }));
    expect(onSelect).toHaveBeenCalledWith("ethronix-labs-ui");
  });

  it("shows the selected project's services with port chips", () => {
    setup("project", { selected: "ethronix-labs-ui" });
    expect(screen.getByText("port 8080")).toBeInTheDocument();
    expect(screen.getByText("What's running")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("shows a vm with facts, hosted projects and a collapsed history", () => {
    const { onOpen } = setup("vm");
    expect(screen.getByText("34.93.253.120", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("port 80")).toBeInTheDocument();
    expect(screen.queryByText("four")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 4" }));
    expect(screen.getByText("four")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "click-print →" }));
    expect(onOpen).toHaveBeenCalledWith("project", "click-print");
  });

  it("links a project to its vm", () => {
    const { onOpen } = setup("project", { selected: "click-print" });
    fireEvent.click(screen.getByRole("button", { name: "click-print-vm →" }));
    expect(onOpen).toHaveBeenCalledWith("vm", "click-print-vm");
    expect(screen.getByText("Good to know")).toBeInTheDocument();
  });

  it("has an empty state", () => {
    render(<Directory kind="vm" files={[]} onSelect={() => undefined} onOpen={() => undefined} />);
    expect(screen.getByText("No VMs recorded yet.")).toBeInTheDocument();
  });
});
