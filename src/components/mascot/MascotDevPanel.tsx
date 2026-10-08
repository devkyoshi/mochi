import { useState } from "react";
import { Mascot } from "./Mascot";
import { MASCOT_STATES, type MascotState } from "./states";

/** Dev-only panel to preview every mascot state. */
export function MascotDevPanel() {
  const [state, setState] = useState<MascotState>("idle");
  return (
    <div className="flex items-center gap-4" data-testid="mascot-dev-panel">
      <Mascot state={state} size={72} />
      <div role="group" aria-label="Mascot state" className="flex flex-wrap gap-1">
        {MASCOT_STATES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={state === s}
            onClick={() => setState(s)}
            className={`rounded-full px-2 py-1 text-xs ${state === s ? "bg-white/20 text-white" : "bg-white/5 text-neutral-400 hover:bg-white/10"}`}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
