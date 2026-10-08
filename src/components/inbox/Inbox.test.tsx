import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Inbox } from "./Inbox";

const INBOX = `# Inbox

- 2026-10-07 — older note (updated_by: claude-code)
- 2026-10-08 — Review needed: ran in project "personal-assistant" (by: mochi-hook)
- 2026-10-08 — click-print: made a \`vms/\` note (updated_by: claude-code)
`;

describe("Inbox", () => {
  it("lists items newest first and flags review stubs", () => {
    render(<Inbox files={[{ path: "inbox.md", content: INBOX }]} />);
    expect(screen.getByText("3 items")).toBeInTheDocument();
    expect(screen.getByText(/1 need review/)).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("click-print");
    expect(items[1]).toHaveAttribute("data-kind", "review");
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.queryByText(/mochi-hook/)).not.toBeInTheDocument();
  });

  it("shows an empty state", () => {
    render(<Inbox files={[]} />);
    expect(screen.getByText("Inbox is empty.")).toBeInTheDocument();
  });
});
