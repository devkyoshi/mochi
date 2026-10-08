interface PillProps {
  onClick: () => void;
}

/** Collapsed dock. The circle is a placeholder for the mascot (Stage 4). */
export function Pill({ onClick }: PillProps) {
  return (
    <button
      type="button"
      aria-label="Open Mochi"
      onClick={onClick}
      className="flex h-full w-full items-center justify-center gap-2 text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-400"
    >
      <span aria-hidden className="h-7 w-7 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.5)]" />
      <span className="text-sm font-medium">Mochi</span>
    </button>
  );
}
