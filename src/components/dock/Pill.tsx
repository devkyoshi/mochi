import { Mascot } from "../mascot";

interface PillProps {
  onClick: () => void;
  /** True when files changed outside Mochi and have not been seen yet. */
  hasNewChange?: boolean;
}

/** Collapsed dock showing the mascot. */
export function Pill({ onClick, hasNewChange = false }: PillProps) {
  return (
    <button
      type="button"
      aria-label="Open Mochi"
      onClick={onClick}
      className="flex h-full w-full items-center justify-center gap-2 text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-400"
    >
      <Mascot state={hasNewChange ? "new-change" : "idle"} size={36} />
      <span className="text-sm font-medium">Mochi</span>
    </button>
  );
}
