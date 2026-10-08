import { useReducer, useState } from "react";
import * as api from "../../lib/api";
import {
  WIZARD_STEPS,
  canAdvance,
  initialWizardState,
  stepIndex,
  wizardReducer,
  type WizardState,
} from "../../lib/wizard/wizardState";
import { ClaudeConnect } from "../chat/ClaudeConnect";
import { GlobalRuleSetup } from "../integration/GlobalRuleSetup";
import { Mascot, type MascotState } from "../mascot";

interface WizardProps {
  /** Persist the finished setup. Resolves to an error message, or null on success. */
  onFinish: (patch: Partial<api.AppConfig>) => Promise<string | null>;
}

const MASCOT_FOR_STEP: Record<WizardState["step"], MascotState> = {
  welcome: "happy",
  directory: "curious",
  claude: "idle",
  rule: "idle",
  preferences: "idle",
  finish: "happy",
};

const buttonClass =
  "rounded-full px-4 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-sky-400 disabled:opacity-40";

export function Wizard({ onFinish }: WizardProps) {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const [busy, setBusy] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const { step, mode, chosenPath, validation } = state;
  const createNew = mode === "new";

  async function choose() {
    const picked = await api.pickFolder().catch(() => null);
    if (!picked) return;
    dispatch({ type: "setPath", path: picked });
    dispatch({ type: "validating" });
    try {
      dispatch({ type: "validated", resolvedPath: await api.validateOpsDirectory(picked, createNew) });
    } catch (e) {
      dispatch({ type: "invalid", message: String(e) });
    }
  }

  async function create() {
    if (!chosenPath) return;
    setBusy(true);
    try {
      const result = await api.setupOpsMemory(chosenPath, createNew);
      dispatch({ type: "scaffolded", path: result.path });
      dispatch({ type: "next" });
    } catch (e) {
      dispatch({ type: "invalid", message: String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    const error = await onFinish({
      opsMemoryPath: state.createdPath,
      hotkey: state.hotkey.trim(),
      autoCollapse: state.autoCollapse,
      sound: state.sound,
      claudeProvider: state.claudeProvider,
      setupComplete: true,
    });
    setFinishError(error);
    setBusy(false);
  }

  const onDirectory = step === "directory";
  const canCreate = onDirectory && validation.status === "ok" && !busy;

  return (
    <div className="flex h-full gap-4 p-4" data-testid="wizard">
      <div className="flex w-20 flex-col items-center justify-center">
        <Mascot state={MASCOT_FOR_STEP[step]} size={72} />
        <p className="mt-1 text-xs text-neutral-500" aria-label="Progress">
          {stepIndex(step) + 1} / {WIZARD_STEPS.length}
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col text-sm text-neutral-300">
        <div className="flex-1 space-y-2 overflow-hidden">
          {step === "welcome" && (
            <>
              <h2 className="text-base font-semibold text-white">Hi, I am Mochi</h2>
              <p>
                I keep a small folder of markdown notes about your servers and deployments, and I show you what is
                running where. Let us set that folder up.
              </p>
            </>
          )}

          {onDirectory && (
            <>
              <h2 className="text-base font-semibold text-white">Where should the notes live?</h2>
              <div role="radiogroup" aria-label="Folder choice" className="flex gap-4">
                {(["new", "existing"] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="dir-mode"
                      checked={mode === m}
                      onChange={() => dispatch({ type: "setMode", mode: m })}
                      className="accent-sky-400"
                    />
                    {m === "new" ? "Create a new ops-memory folder" : "Use an existing folder"}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void choose()} className={`${buttonClass} bg-white/10 text-white`}>
                  {createNew ? "Choose parent folder…" : "Choose folder…"}
                </button>
                <span className="truncate text-neutral-400">{chosenPath ?? "Nothing chosen yet"}</span>
              </div>
              {validation.status === "checking" && <p className="text-neutral-400">Checking…</p>}
              {validation.status === "ok" && (
                <p className="truncate text-emerald-300">Will use: {validation.resolvedPath}</p>
              )}
              {validation.status === "error" && (
                <p role="alert" className="text-amber-300">
                  {validation.message}
                </p>
              )}
            </>
          )}

          {step === "claude" && (
            <>
              <h2 className="text-base font-semibold text-white">Connect Claude</h2>
              <p>Chat with Claude about your notes. You can skip this and connect later in Settings.</p>
              <ClaudeConnect connected={state.claudeProvider} onConnected={(provider) => dispatch({ type: "setClaude", provider })} />
            </>
          )}

          {step === "rule" && (
            <>
              <h2 className="text-base font-semibold text-white">Keep notes up to date automatically</h2>
              <p>
                An optional global rule and two hooks make Claude Code update these notes after server work in any
                project. You review every change first; you can skip this and do it later in Settings.
              </p>
              <GlobalRuleSetup opsPath={state.createdPath} />
            </>
          )}

          {step === "preferences" && (
            <>
              <h2 className="text-base font-semibold text-white">Preferences</h2>
              <label className="flex items-center gap-2">
                Show/hide shortcut
                <input
                  aria-label="Shortcut"
                  value={state.hotkey}
                  onChange={(e) => dispatch({ type: "setPref", pref: "hotkey", value: e.target.value })}
                  className="rounded bg-white/10 px-2 py-1 text-white"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={state.autoCollapse}
                  onChange={(e) => dispatch({ type: "setPref", pref: "autoCollapse", value: e.target.checked })}
                  className="accent-sky-400"
                />
                Collapse when I click elsewhere
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={state.sound}
                  onChange={(e) => dispatch({ type: "setPref", pref: "sound", value: e.target.checked })}
                  className="accent-sky-400"
                />
                Mascot sounds
              </label>
            </>
          )}

          {step === "finish" && (
            <>
              <h2 className="text-base font-semibold text-white">All set</h2>
              <p className="truncate">Your notes are in {state.createdPath}</p>
              {finishError && (
                <p role="alert" className="text-amber-300">
                  {finishError}
                </p>
              )}
            </>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => dispatch({ type: "back" })}
            disabled={step === "welcome" || busy}
            className={`${buttonClass} text-neutral-400 hover:text-white`}
          >
            Back
          </button>
          {step === "finish" ? (
            <button type="button" onClick={() => void finish()} disabled={busy} className={`${buttonClass} bg-sky-500 text-white`}>
              Finish
            </button>
          ) : onDirectory ? (
            <button type="button" onClick={() => void create()} disabled={!canCreate} className={`${buttonClass} bg-sky-500 text-white`}>
              Create and continue
            </button>
          ) : (
            <button
              type="button"
              onClick={() => dispatch({ type: "next" })}
              disabled={!canAdvance(state) || busy}
              className={`${buttonClass} bg-sky-500 text-white`}
            >
              {step === "welcome" ? "Get started" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
