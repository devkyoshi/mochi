import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDigestRequest, DIGEST_SYSTEM, weekChanges } from "./claude/digest";
import { isIdle, useIdle } from "./idle";
import { chirpLength, chirpPlan, useSound, VOLUME } from "./sound";
import { nextTabIndex, TabBar } from "../components/dock/TabBar";
import { pillState } from "../components/dock/Pill";

const FILES = [
  {
    path: "changelog/2026-10.md",
    content:
      "# Changelog 2026-10\n\n- 2026-10-08 — Upgraded nginx (vm: prod)\n- 2026-10-03 — Deployed app (project: app)\n- 2026-10-02 — Edge of window (vm: prod)\n- 2026-10-01 — Too old (vm: prod)\n",
  },
  { path: "changelog/2026-09.md", content: "- 2026-09-30 — Last month\n" },
];

describe("weekChanges", () => {
  it("keeps the last 7 days including today, newest first", () => {
    const out = weekChanges(FILES, "2026-10-08");
    expect(out.map((c) => c.date)).toEqual(["2026-10-08", "2026-10-03", "2026-10-02"]);
  });
  it("crosses month boundaries", () => {
    expect(weekChanges(FILES, "2026-10-03").map((c) => c.date)).toEqual(["2026-10-03", "2026-10-02", "2026-10-01", "2026-09-30"]);
  });
  it("ignores future lines, a custom window, and bad dates", () => {
    expect(weekChanges(FILES, "2026-10-01").map((c) => c.date)).toEqual(["2026-10-01", "2026-09-30"]);
    expect(weekChanges(FILES, "2026-10-08", 1).map((c) => c.date)).toEqual(["2026-10-08"]);
    expect(weekChanges(FILES, "not-a-date")).toEqual([]);
  });
});

describe("buildDigestRequest", () => {
  it("returns null with nothing to summarise", () => {
    expect(buildDigestRequest([], "2026-10-08")).toBeNull();
  });
  it("includes only the given lines and forbids edits and invention", () => {
    const req = buildDigestRequest(weekChanges(FILES, "2026-10-08"), "2026-10-08")!;
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].content).toContain("- 2026-10-08 — Upgraded nginx (vm: prod)");
    expect(req.messages[0].content).not.toContain("Too old");
    expect(req.system).toBe(DIGEST_SYSTEM);
    expect(DIGEST_SYSTEM).toMatch(/do not output any <mochi-edit> blocks/);
    expect(DIGEST_SYSTEM).toMatch(/Never invent facts/);
  });
});

describe("isIdle", () => {
  it("compares against the threshold inclusively", () => {
    expect(isIdle(0, 599, 600)).toBe(false);
    expect(isIdle(0, 600, 600)).toBe(true);
    expect(isIdle(1000, 5000, 600)).toBe(true);
  });
});

describe("useIdle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("becomes idle after the threshold and wakes on activity", () => {
    const { result } = renderHook(() => useIdle(60_000));
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(59_000);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current).toBe(true);
    act(() => {
      window.dispatchEvent(new Event("mousemove"));
    });
    expect(result.current).toBe(false);
  });

  it("activity postpones sleeping", () => {
    const { result } = renderHook(() => useIdle(60_000));
    act(() => {
      vi.advanceTimersByTime(50_000);
      window.dispatchEvent(new Event("keydown"));
      vi.advanceTimersByTime(50_000);
    });
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(11_000);
    });
    expect(result.current).toBe(true);
  });

  it("never reports idle while disabled", () => {
    const { result } = renderHook(() => useIdle(1000, false));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe(false);
  });
});

describe("chirps", () => {
  it("every chirp is short, soft and audible", () => {
    for (const kind of ["happy", "alert", "change"] as const) {
      const plan = chirpPlan(kind);
      expect(plan.length).toBeGreaterThan(0);
      expect(chirpLength(kind)).toBeLessThan(0.5);
      for (const n of plan) {
        expect(n.freq).toBeGreaterThanOrEqual(200);
        expect(n.freq).toBeLessThanOrEqual(2000);
        expect(n.dur).toBeGreaterThan(0);
      }
    }
    expect(VOLUME).toBeLessThanOrEqual(0.1);
  });
});

describe("useSound", () => {
  const created: number[] = [];
  class FakeAudio {
    currentTime = 0;
    destination = {};
    constructor() {
      created.push(1);
    }
    resume = () => Promise.resolve();
    close = () => Promise.resolve();
    createOscillator = () => {
      const osc = { type: "", frequency: { value: 0 }, connect: (x: unknown) => x, start: vi.fn(), stop: vi.fn() };
      oscillators.push(osc);
      return osc;
    };
    createGain = () => ({ gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: (x: unknown) => x });
  }
  const oscillators: { start: ReturnType<typeof vi.fn> }[] = [];

  beforeEach(() => {
    created.length = 0;
    oscillators.length = 0;
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudio;
  });
  afterEach(() => {
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it("plays one oscillator per note when enabled", () => {
    const { result } = renderHook(() => useSound(true));
    result.current("happy");
    expect(oscillators).toHaveLength(chirpPlan("happy").length);
    expect(oscillators.every((o) => o.start.mock.calls.length === 1)).toBe(true);
    result.current("change");
    expect(created).toHaveLength(1); // context is reused
  });

  it("is silent when muted, and follows the toggle live", () => {
    const { result, rerender } = renderHook(({ on }) => useSound(on), { initialProps: { on: false } });
    result.current("alert");
    expect(created).toHaveLength(0);
    rerender({ on: true });
    result.current("alert");
    expect(oscillators).toHaveLength(2);
    rerender({ on: false });
    result.current("alert");
    expect(oscillators).toHaveLength(2);
  });

  it("does nothing, without throwing, when audio is unavailable or fails", () => {
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    const { result } = renderHook(() => useSound(true));
    expect(() => result.current("happy")).not.toThrow();
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = class {
      constructor() {
        throw new Error("blocked");
      }
    };
    const again = renderHook(() => useSound(true));
    expect(() => again.result.current("happy")).not.toThrow();
  });
});

describe("pillState", () => {
  it("alerts beat new changes beat sleeping", () => {
    expect(pillState({ alert: true, newChange: true, sleepy: true })).toBe("alert");
    expect(pillState({ alert: false, newChange: true, sleepy: true })).toBe("new-change");
    expect(pillState({ alert: false, newChange: false, sleepy: true })).toBe("sleepy");
    expect(pillState({ alert: false, newChange: false, sleepy: false })).toBe("idle");
  });
});

describe("nextTabIndex", () => {
  it("wraps with arrows and jumps with Home/End", () => {
    expect(nextTabIndex(0, "ArrowRight", 5)).toBe(1);
    expect(nextTabIndex(4, "ArrowRight", 5)).toBe(0);
    expect(nextTabIndex(0, "ArrowLeft", 5)).toBe(4);
    expect(nextTabIndex(2, "Home", 5)).toBe(0);
    expect(nextTabIndex(2, "End", 5)).toBe(4);
    expect(nextTabIndex(2, "a", 5)).toBeNull();
  });
});

describe("TabBar keyboard navigation", () => {
  it("uses a roving tabindex and arrow keys select and focus the next tab", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<TabBar tab="home" sound onSelect={onSelect} onToggleSound={() => undefined} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1", "-1"]);

    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("browse");
    await waitFor(() => expect(document.activeElement).toBe(tabs[1]));

    fireEvent.keyDown(tabs[0], { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenLastCalledWith("settings");
    fireEvent.keyDown(tabs[0], { key: "End" });
    expect(onSelect).toHaveBeenLastCalledWith("settings");

    rerender(<TabBar tab="chat" sound onSelect={onSelect} onToggleSound={() => undefined} />);
    expect(screen.getAllByRole("tab").map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "-1", "0", "-1", "-1"]);
  });
});
