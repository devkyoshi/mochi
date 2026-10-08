import { Mascot, type MascotState } from "../mascot";

interface PillProps {
  onClick: () => void;
  /** What the mascot is doing (alert, new-change, sleepy or idle). */
  mascotState?: MascotState;
}

/** Collapsed dock showing the mascot. */
export function Pill({ onClick, mascotState = "idle" }: PillProps) {
  return (
    <button
      type="button"
      aria-label="Open Mochi"
      onClick={onClick}
      className="flex h-full w-full items-center justify-center gap-2 text-neutral-100"
    >
      <Mascot state={mascotState} size={36} />
      <span className="text-sm font-medium">Mochi</span>
    </button>
  );
}

/** Which mascot state the collapsed pill shows. Alerts beat new changes, which beat sleeping. */
export function pillState(flags: { alert: boolean; newChange: boolean; sleepy: boolean }): MascotState {
  if (flags.alert) return "alert";
  if (flags.newChange) return "new-change";
  if (flags.sleepy) return "sleepy";
  return "idle";
}
