import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isAutoCollapseSuspended, RELEASE_DELAY_MS, withAutoCollapseSuspended } from "./autoCollapseGuard";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("auto-collapse guard", () => {
  it("is off by default", () => {
    expect(isAutoCollapseSuspended()).toBe(false);
  });

  it("is on while the dialog is open and for a short while after it closes", async () => {
    let close: (v: string) => void = () => undefined;
    const result = withAutoCollapseSuspended(() => new Promise<string>((r) => (close = r)));
    expect(isAutoCollapseSuspended()).toBe(true);
    close("C:/notes");
    await expect(result).resolves.toBe("C:/notes");
    expect(isAutoCollapseSuspended()).toBe(true); // focus changes right after closing still belong to the dialog
    vi.advanceTimersByTime(RELEASE_DELAY_MS - 1);
    expect(isAutoCollapseSuspended()).toBe(true);
    vi.advanceTimersByTime(2);
    expect(isAutoCollapseSuspended()).toBe(false);
  });

  it("is released even if the dialog fails or is cancelled", async () => {
    await expect(withAutoCollapseSuspended(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    vi.advanceTimersByTime(RELEASE_DELAY_MS + 1);
    expect(isAutoCollapseSuspended()).toBe(false);
  });

  it("supports overlapping dialogs", async () => {
    await withAutoCollapseSuspended(async () => 1);
    vi.advanceTimersByTime(100);
    await withAutoCollapseSuspended(async () => 2);
    vi.advanceTimersByTime(RELEASE_DELAY_MS - 50); // first released, second still pending
    expect(isAutoCollapseSuspended()).toBe(true);
    vi.advanceTimersByTime(100);
    expect(isAutoCollapseSuspended()).toBe(false);
  });
});
