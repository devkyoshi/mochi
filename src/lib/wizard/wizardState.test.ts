import { describe, expect, it } from "vitest";
import { canAdvance, initialWizardState, stepIndex, wizardReducer, WIZARD_STEPS, type WizardState } from "./wizardState";

const at = (step: WizardState["step"], extra: Partial<WizardState> = {}): WizardState => ({
  ...initialWizardState,
  step,
  ...extra,
});

describe("wizardReducer", () => {
  it("has the six documented steps in order", () => {
    expect([...WIZARD_STEPS]).toEqual(["welcome", "directory", "claude", "rule", "preferences", "finish"]);
  });

  it("moves forward and back", () => {
    let s = wizardReducer(initialWizardState, { type: "next" });
    expect(s.step).toBe("directory");
    s = wizardReducer(s, { type: "back" });
    expect(s.step).toBe("welcome");
  });

  it("cannot go back from the first step", () => {
    expect(wizardReducer(initialWizardState, { type: "back" }).step).toBe("welcome");
  });

  it("blocks leaving the directory step until the folder is created", () => {
    const s = at("directory");
    expect(canAdvance(s)).toBe(false);
    expect(wizardReducer(s, { type: "next" })).toBe(s);
    const done = wizardReducer(s, { type: "scaffolded", path: "D:/ops-memory" });
    expect(canAdvance(done)).toBe(true);
    expect(wizardReducer(done, { type: "next" }).step).toBe("claude");
  });

  it("does not allow going back into the directory step after the folder exists", () => {
    const s = at("claude", { createdPath: "D:/ops-memory" });
    expect(wizardReducer(s, { type: "back" }).step).toBe("claude");
  });

  it("changing mode or path discards validation and the created path", () => {
    const s = at("directory", {
      chosenPath: "D:/x",
      createdPath: "D:/x/ops-memory",
      validation: { status: "ok", resolvedPath: "D:/x/ops-memory" },
    });
    for (const next of [wizardReducer(s, { type: "setMode", mode: "existing" }), wizardReducer(s, { type: "setPath", path: "D:/y" })]) {
      expect(next.createdPath).toBeNull();
      expect(next.validation).toEqual({ status: "idle" });
    }
    expect(wizardReducer(s, { type: "setMode", mode: "new" })).toBe(s);
  });

  it("tracks validation results", () => {
    let s = wizardReducer(at("directory"), { type: "validating" });
    expect(s.validation.status).toBe("checking");
    s = wizardReducer(s, { type: "validated", resolvedPath: "D:/ops" });
    expect(s.validation).toEqual({ status: "ok", resolvedPath: "D:/ops" });
    s = wizardReducer(s, { type: "invalid", message: "nope" });
    expect(s.validation).toEqual({ status: "error", message: "nope" });
  });

  it("requires a non-empty hotkey on the preferences step", () => {
    const s = wizardReducer(at("preferences"), { type: "setPref", pref: "hotkey", value: "  " });
    expect(canAdvance(s)).toBe(false);
    expect(canAdvance(wizardReducer(s, { type: "setPref", pref: "hotkey", value: "Alt+M" }))).toBe(true);
  });

  it("updates boolean prefs and never advances past finish", () => {
    const s = wizardReducer(initialWizardState, { type: "setPref", pref: "sound", value: false });
    expect(s.sound).toBe(false);
    const fin = at("finish");
    expect(wizardReducer(fin, { type: "next" })).toBe(fin);
    expect(stepIndex("finish")).toBe(5);
  });
});
