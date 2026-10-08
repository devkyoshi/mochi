import { describe, expect, it } from "vitest";
import { dockReducer, initialDockState, type DockState } from "./dockState";

const expanded: DockState = { ...initialDockState, expanded: true };

describe("dockReducer", () => {
  it("starts collapsed on the home tab", () => {
    expect(initialDockState).toEqual({ expanded: false, tab: "home", autoCollapse: true });
  });
  it("toggle flips expanded", () => {
    expect(dockReducer(initialDockState, { type: "toggle" }).expanded).toBe(true);
    expect(dockReducer(expanded, { type: "toggle" }).expanded).toBe(false);
  });
  it("expand and collapse are idempotent (same object returned)", () => {
    expect(dockReducer(expanded, { type: "expand" })).toBe(expanded);
    expect(dockReducer(initialDockState, { type: "collapse" })).toBe(initialDockState);
    expect(dockReducer(initialDockState, { type: "expand" }).expanded).toBe(true);
    expect(dockReducer(expanded, { type: "collapse" }).expanded).toBe(false);
  });
  it("blur collapses only when auto-collapse is on and expanded", () => {
    expect(dockReducer(expanded, { type: "blur" }).expanded).toBe(false);
    const manual = { ...expanded, autoCollapse: false };
    expect(dockReducer(manual, { type: "blur" })).toBe(manual);
    expect(dockReducer(initialDockState, { type: "blur" })).toBe(initialDockState);
  });
  it("selectTab changes the tab and keeps expanded state", () => {
    const s = dockReducer(expanded, { type: "selectTab", tab: "chat" });
    expect(s).toMatchObject({ tab: "chat", expanded: true });
    expect(dockReducer(s, { type: "selectTab", tab: "chat" })).toBe(s);
  });
  it("setAutoCollapse updates the flag", () => {
    expect(dockReducer(initialDockState, { type: "setAutoCollapse", value: false }).autoCollapse).toBe(false);
  });
});
