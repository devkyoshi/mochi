import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers: { changed?: (p: string[]) => void } = {};
const api = vi.hoisted(() => ({
  listOpsFiles: vi.fn(),
  readOpsFile: vi.fn(),
  onOpsChanged: vi.fn(),
}));
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, ...api };
});

import { buildOpsData, RELOAD_DEBOUNCE_MS, useOpsMemory } from "./useOpsMemory";

const VM = "---\ntype: vm\nname: prod\nlast_updated: 2026-10-07\n---\nbody nginx\n";
let files: Record<string, string>;

beforeEach(() => {
  files = { "vms/prod.md": VM, "inbox.md": "# Inbox\n" };
  handlers.changed = undefined;
  api.listOpsFiles.mockReset().mockImplementation(() => Promise.resolve(Object.keys(files).map((path) => ({ path, size: 1 }))));
  api.readOpsFile.mockReset().mockImplementation((p: string) => Promise.resolve(files[p]));
  api.onOpsChanged.mockReset().mockImplementation((cb: (p: string[]) => void) => {
    handlers.changed = cb;
    return Promise.resolve(() => undefined);
  });
});

describe("buildOpsData", () => {
  it("parses vm/project files and reports invalid ones, ignoring other files", () => {
    const data = buildOpsData([
      { path: "vms/prod.md", content: VM },
      { path: "vms/bad.md", content: "no frontmatter" },
      { path: "projects/app.md", content: "---\ntype: project\nname: app\n---\n" },
      { path: "inbox.md", content: "x" },
      { path: "vms/sub/deep.md", content: "x" },
    ]);
    expect(data.entries.map((e) => e.name)).toEqual(["prod", "app"]);
    expect(data.invalid).toHaveLength(1);
    expect(data.invalid[0].path).toBe("vms/bad.md");
    expect(data.files).toHaveLength(5);
  });
});

describe("useOpsMemory", () => {
  it("does nothing while disabled", async () => {
    renderHook(() => useOpsMemory(false));
    await act(async () => undefined);
    expect(api.listOpsFiles).not.toHaveBeenCalled();
  });

  it("loads files and entries when enabled", async () => {
    const { result } = renderHook(() => useOpsMemory(true));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.files).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("searches loaded files", async () => {
    const { result } = renderHook(() => useOpsMemory(true));
    await waitFor(() => expect(result.current.files).toHaveLength(2));
    expect(result.current.runSearch("nginx").map((h) => h.path)).toEqual(["vms/prod.md"]);
  });

  it("reports load errors", async () => {
    api.listOpsFiles.mockRejectedValue("Ops Memory is not set up yet.");
    const { result } = renderHook(() => useOpsMemory(true));
    await waitFor(() => expect(result.current.error).toContain("not set up"));
  });

  it("flags external changes and reloads after the debounce, then clears", async () => {
    const { result } = renderHook(() => useOpsMemory(true));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    expect(result.current.externalChange).toBe(false);

    files["vms/staging.md"] = "---\ntype: vm\nname: staging\n---\n";
    act(() => handlers.changed?.(["vms/staging.md"]));
    expect(result.current.externalChange).toBe(true);
    expect(result.current.changedPaths).toEqual(["vms/staging.md"]);

    await waitFor(() => expect(result.current.entries).toHaveLength(2), { timeout: RELOAD_DEBOUNCE_MS * 5 });

    act(() => result.current.clearExternalChange());
    expect(result.current.externalChange).toBe(false);
    expect(result.current.changedPaths).toEqual([]);
  });

  it("coalesces rapid change events into one reload", async () => {
    const { result } = renderHook(() => useOpsMemory(true));
    await waitFor(() => expect(result.current.entries).toHaveLength(1));
    api.listOpsFiles.mockClear();
    act(() => {
      handlers.changed?.(["a.md"]);
      handlers.changed?.(["b.md"]);
      handlers.changed?.(["a.md"]);
    });
    await waitFor(() => expect(api.listOpsFiles).toHaveBeenCalledTimes(1), { timeout: RELOAD_DEBOUNCE_MS * 5 });
    expect(result.current.changedPaths.sort()).toEqual(["a.md", "b.md"]);
  });
});
