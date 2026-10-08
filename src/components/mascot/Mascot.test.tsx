import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Mascot } from "./Mascot";
import { MascotDevPanel } from "./MascotDevPanel";
import { MASCOT_STATES, pupilOffset } from "./states";

function mockMatchMedia(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  // @ts-expect-error restore jsdom default (no matchMedia)
  delete window.matchMedia;
});

describe("pupilOffset", () => {
  const eye = { x: 50, y: 50 };
  it("is zero without a cursor or when the cursor is on the eye", () => {
    expect(pupilOffset(eye, null, 4)).toEqual({ x: 0, y: 0 });
    expect(pupilOffset(eye, eye, 4)).toEqual({ x: 0, y: 0 });
  });
  it("points toward the cursor", () => {
    const o = pupilOffset(eye, { x: 200, y: 50 }, 4);
    expect(o.x).toBeGreaterThan(0);
    expect(o.y).toBeCloseTo(0);
    expect(pupilOffset(eye, { x: 50, y: -100 }, 4).y).toBeLessThan(0);
  });
  it("never exceeds the maximum offset", () => {
    for (const c of [{ x: 1e6, y: 1e6 }, { x: -500, y: 20 }, { x: 55, y: 55 }]) {
      const o = pupilOffset(eye, c, 4);
      expect(Math.hypot(o.x, o.y)).toBeLessThanOrEqual(4 + 1e-9);
    }
  });
  it("moves less for a nearby cursor than a far one", () => {
    const near = pupilOffset(eye, { x: 60, y: 50 }, 4);
    const far = pupilOffset(eye, { x: 300, y: 50 }, 4);
    expect(near.x).toBeLessThan(far.x);
  });
});

describe("Mascot", () => {
  it("renders every state with a matching data attribute and accessible label", () => {
    for (const state of MASCOT_STATES) {
      const { unmount } = render(<Mascot state={state} />);
      const el = screen.getByRole("img");
      expect(el).toHaveAttribute("data-state", state);
      expect(el.getAttribute("aria-label")).toMatch(/^Mochi /);
      unmount();
    }
  });

  it("shows the thinking bubble only while thinking", () => {
    const { rerender } = render(<Mascot state="idle" />);
    expect(screen.queryByTestId("thinking-bubble")).toBeNull();
    rerender(<Mascot state="thinking" />);
    expect(screen.getByTestId("thinking-bubble")).toBeInTheDocument();
  });

  it("shows sparkles only when happy", () => {
    const { rerender } = render(<Mascot state="idle" />);
    expect(screen.queryByTestId("sparkles")).toBeNull();
    rerender(<Mascot state="happy" />);
    expect(screen.getByTestId("sparkles")).toBeInTheDocument();
  });

  it("shows a badge in new-change or when requested", () => {
    const { rerender } = render(<Mascot state="idle" />);
    expect(screen.queryByTestId("badge")).toBeNull();
    rerender(<Mascot state="idle" badge />);
    expect(screen.getByTestId("badge")).toBeInTheDocument();
    rerender(<Mascot state="new-change" />);
    expect(screen.getByTestId("badge")).toBeInTheDocument();
  });

  it("respects the size prop", () => {
    render(<Mascot state="idle" size={50} />);
    expect(screen.getByRole("img")).toHaveStyle({ width: "50px", height: "50px" });
  });

  it("flags reduced motion", () => {
    mockMatchMedia(true);
    render(<Mascot state="idle" />);
    expect(screen.getByRole("img")).toHaveAttribute("data-reduced-motion", "true");
  });

  it("tracks the cursor only in the curious state", () => {
    const pupils = () => document.querySelectorAll(".mascot-pupil");
    const { rerender } = render(<Mascot state="curious" />);
    const svg = document.querySelector("svg")!;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    const before = pupils()[0].getAttribute("cx");
    act(() => {
      fireEvent.mouseMove(window, { clientX: 400, clientY: 50 });
    });
    expect(pupils()[0].getAttribute("cx")).not.toBe(before);

    rerender(<Mascot state="idle" />);
    act(() => {
      fireEvent.mouseMove(window, { clientX: 0, clientY: 0 });
    });
    expect(pupils()[0].getAttribute("cx")).toBe("38");
  });

  it("does not track the cursor with reduced motion", () => {
    mockMatchMedia(true);
    render(<Mascot state="curious" />);
    act(() => {
      fireEvent.mouseMove(window, { clientX: 400, clientY: 50 });
    });
    expect(document.querySelectorAll(".mascot-pupil")[0].getAttribute("cx")).toBe("38");
  });
});

describe("MascotDevPanel", () => {
  it("switches between all seven states", () => {
    render(<MascotDevPanel />);
    expect(screen.getAllByRole("button")).toHaveLength(7);
    for (const state of MASCOT_STATES) {
      fireEvent.click(screen.getByRole("button", { name: state }));
      expect(screen.getByRole("img")).toHaveAttribute("data-state", state);
      expect(screen.getByRole("button", { name: state })).toHaveAttribute("aria-pressed", "true");
    }
  });
});
