import type { ClaudeProviderKind } from "../api";

export const WIZARD_STEPS = ["welcome", "directory", "claude", "rule", "preferences", "finish"] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export type DirMode = "new" | "existing";

export type Validation =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; resolvedPath: string }
  | { status: "error"; message: string };

export interface WizardState {
  step: WizardStep;
  mode: DirMode;
  chosenPath: string | null;
  validation: Validation;
  /** Final scaffolded path, set once the directory step succeeded. */
  createdPath: string | null;
  hotkey: string;
  autoCollapse: boolean;
  sound: boolean;
  /** Provider that passed its test call, if any (the step can be skipped). */
  claudeProvider: ClaudeProviderKind | null;
}

export type WizardAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "setMode"; mode: DirMode }
  | { type: "setPath"; path: string | null }
  | { type: "validating" }
  | { type: "validated"; resolvedPath: string }
  | { type: "invalid"; message: string }
  | { type: "scaffolded"; path: string }
  | { type: "setClaude"; provider: ClaudeProviderKind }
  | { type: "setPref"; pref: "hotkey"; value: string }
  | { type: "setPref"; pref: "autoCollapse" | "sound"; value: boolean };

export const initialWizardState: WizardState = {
  step: "welcome",
  mode: "new",
  chosenPath: null,
  validation: { status: "idle" },
  createdPath: null,
  hotkey: "CommandOrControl+Shift+Space",
  autoCollapse: true,
  sound: true,
  claudeProvider: null,
};

/** Whether the current step allows moving forward. */
export function canAdvance(state: WizardState): boolean {
  switch (state.step) {
    case "directory":
      return state.createdPath !== null;
    case "preferences":
      return state.hotkey.trim() !== "";
    case "finish":
      return false;
    default:
      return true;
  }
}

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step);
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "next": {
      if (!canAdvance(state)) return state;
      return { ...state, step: WIZARD_STEPS[Math.min(stepIndex(state.step) + 1, WIZARD_STEPS.length - 1)] };
    }
    case "back": {
      // Once the folder has been created, going back into the directory step would be confusing.
      const floor = state.createdPath ? stepIndex("claude") : 0;
      const target = Math.max(stepIndex(state.step) - 1, floor);
      return { ...state, step: WIZARD_STEPS[target] };
    }
    case "setMode":
      return state.mode === action.mode
        ? state
        : { ...state, mode: action.mode, validation: { status: "idle" }, createdPath: null };
    case "setPath":
      return { ...state, chosenPath: action.path, validation: { status: "idle" }, createdPath: null };
    case "validating":
      return { ...state, validation: { status: "checking" } };
    case "validated":
      return { ...state, validation: { status: "ok", resolvedPath: action.resolvedPath } };
    case "invalid":
      return { ...state, validation: { status: "error", message: action.message }, createdPath: null };
    case "scaffolded":
      return { ...state, createdPath: action.path };
    case "setClaude":
      return { ...state, claudeProvider: action.provider };
    case "setPref":
      return { ...state, [action.pref]: action.value } as WizardState;
  }
}
