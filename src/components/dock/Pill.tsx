import { Mascot } from "../mascot";

interface PillProps {
  onClick: () => void;
}

/** Collapsed dock showing the mascot. */
export function Pill({ onClick }: PillProps) {
  return (
    <button
      type="button"
      aria-label="Open Mochi"
      onClick={onClick}
      className="flex h-full w-full items-center justify-center gap-2 text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-400"
    >
      <Mascot state="idle" size={36} />
      <span className="text-sm font-medium">Mochi</span>
    </button>
  );
}
