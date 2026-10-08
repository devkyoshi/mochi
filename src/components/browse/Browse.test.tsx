import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ writeOpsFile: vi.fn(), undoLastChange: vi.fn() }));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, ...api };
});

import { Browse } from "./Browse";
import { MarkdownView } from "./MarkdownView";
import { buildOpsData } from "../../lib/ops/useOpsMemory";
import { buildSearchIndex, search } from "../../lib/opsMemory";

const FILES = [
  { path: "vms/prod.md", content: "---\ntype: vm\nname: prod\nlast_updated: 2026-10-07\n---\n\n## Purpose\nRuns **nginx**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n" },
  { path: "projects/app.md", content: "---\ntype: project\nname: app\n---\nHello\n" },
  { path: "inbox.md", content: "# Inbox\nbilling todo\n" },
];

function setup(onMutated = vi.fn(), reload = vi.fn().mockResolvedValue(undefined)) {
  const data = buildOpsData(FILES);
  const index = buildSearchIndex(FILES);
  render(<Browse data={data} runSearch={(q) => search(index, FILES, q)} reload={reload} onMutated={onMutated} />);
  return { reload, onMutated };
}

beforeEach(() => {
  api.writeOpsFile.mockReset().mockResolvedValue({ status: "saved", commit: "abc1234" });
  api.undoLastChange.mockReset().mockResolvedValue("def5678");
});

describe("MarkdownView", () => {
  it("renders the body as markdown, tables included, and frontmatter as chips", () => {
    render(<MarkdownView content={FILES[0].content} />);
    expect(screen.getByRole("heading", { name: "Purpose" })).toBeInTheDocument();
    expect(screen.getByText("nginx").tagName).toBe("STRONG");
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByTestId("frontmatter")).toHaveTextContent("last_updated:2026-10-07");
  });

  it("does not render raw HTML", () => {
    render(<MarkdownView content={"x\n\n<script>window.hacked=1</script><img src=x onerror=alert(1)>\n"} />);
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("copes with invalid frontmatter", () => {
    render(<MarkdownView content={"---\na: [oops\n---\nbody text\n"} />);
    expect(screen.queryByTestId("frontmatter")).toBeNull();
  });
});

describe("Browse", () => {
  it("lists files grouped by kind", () => {
    setup();
    expect(screen.getByText("VMs")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /prod\.md/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /inbox\.md/ })).toBeInTheDocument();
  });

  it("shows the selected file rendered", () => {
    setup();
    expect(screen.getByText("Pick a file on the left.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /prod\.md/ }));
    expect(screen.getByRole("heading", { name: "Purpose" })).toBeInTheDocument();
  });

  it("filters by search and shows a snippet", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "billing" } });
    expect(screen.getByRole("button", { name: /inbox\.md/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /prod\.md/ })).toBeNull();
    expect(screen.getByText(/billing todo/)).toBeInTheDocument();
  });

  it("says when nothing matches", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Search notes"), { target: { value: "zzzzqqq" } });
    expect(screen.getByText("No matches.")).toBeInTheDocument();
  });

  it("edits a file: review diff, then save through the pipeline", async () => {
    const { reload, onMutated } = setup();
    fireEvent.click(screen.getByRole("button", { name: /prod\.md/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
    const source = screen.getByLabelText("Markdown source") as HTMLTextAreaElement;
    fireEvent.change(source, { target: { value: source.value.replace("Runs **nginx**", "Runs **nginx 1.27**") } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));

    const diffRoot = screen.getByLabelText("Changes");
    expect(diffRoot.querySelector('[data-kind="remove"]')).toHaveTextContent("Runs **nginx**");
    expect(diffRoot.querySelector('[data-kind="add"]')).toHaveTextContent("Runs **nginx 1.27**");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.writeOpsFile).toHaveBeenCalledTimes(1));
    const [path, content, message] = api.writeOpsFile.mock.calls[0];
    expect(path).toBe("vms/prod.md");
    expect(content).toContain("Runs **nginx 1.27**");
    expect(message).toBe("update prod");
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(onMutated).toHaveBeenCalled();
    expect(screen.queryByTestId("file-editor")).toBeNull();
  });

  it("frontmatter form edits only that field in the source", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /prod\.md/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByDisplayValue("2026-10-07"), { target: { value: "2026-10-08" } });
    const source = (screen.getByLabelText("Markdown source") as HTMLTextAreaElement).value;
    expect(source).toBe(FILES[0].content.replace("2026-10-07", "2026-10-08"));
  });

  it("shows redacted findings and keeps the draft when the save is blocked", async () => {
    api.writeOpsFile.mockResolvedValue({
      status: "blocked",
      findings: [{ kind: "credential_assignment", line: 3, preview: "DB_PASSWORD=Sup… (17 chars)" }],
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /prod\.md/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Markdown source"), { target: { value: "DB_PASSWORD=SuperSecret123!" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("contains secrets");
    expect(alert).toHaveTextContent("Line 3: credential value");
    expect(alert).not.toHaveTextContent("SuperSecret123!");
    expect((screen.getByLabelText("Markdown source") as HTMLTextAreaElement).value).toBe("DB_PASSWORD=SuperSecret123!");
  });

  it("shows backend errors on save", async () => {
    api.writeOpsFile.mockRejectedValue("Could not write file");
    setup();
    fireEvent.click(screen.getByRole("button", { name: /prod\.md/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Markdown source"), { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Could not write file")).toBeInTheDocument();
  });

  it("cancel leaves editing without saving", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /prod\.md/ }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("file-editor")).toBeNull();
    expect(api.writeOpsFile).not.toHaveBeenCalled();
  });

  it("undoes the last change and reloads", async () => {
    const { reload, onMutated } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Undo last change" }));
    expect(await screen.findByText("Last change undone.")).toBeInTheDocument();
    expect(reload).toHaveBeenCalled();
    expect(onMutated).toHaveBeenCalled();
  });

  it("shows an error when there is nothing to undo", async () => {
    api.undoLastChange.mockRejectedValue("Nothing to undo.");
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Undo last change" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Nothing to undo.");
  });
});
