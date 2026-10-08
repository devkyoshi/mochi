import { useEffect, useRef, useState } from "react";
import { pupilOffset, type MascotState, type Point } from "./states";
import { useReducedMotion } from "./useReducedMotion";
import "./mascot.css";

export interface MascotProps {
  state: MascotState;
  /** Rendered width/height in px. */
  size?: number;
  /** Show a small badge dot (e.g. unseen changes). Always shown in `new-change`. */
  badge?: boolean;
}

const LEFT_EYE: Point = { x: 38, y: 52 };
const RIGHT_EYE: Point = { x: 62, y: 52 };

const LABELS: Record<MascotState, string> = {
  idle: "Mochi is relaxing",
  curious: "Mochi is watching your cursor",
  thinking: "Mochi is thinking",
  happy: "Mochi is happy",
  alert: "Mochi needs your attention",
  sleepy: "Mochi is sleepy",
  "new-change": "Mochi noticed a change",
};

/**
 * The mascot. Drawn with SVG/CSS; a Rive file can replace the internals later without changing
 * this API (see docs/mascot.md).
 */
export function Mascot({ state, size = 96, badge = false }: MascotProps) {
  const reduced = useReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  // Eye tracking only in the `curious` state, and never with reduced motion.
  const tracking = state === "curious" && !reduced;
  useEffect(() => {
    if (!tracking) return;
    const onMove = (e: MouseEvent) => {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      const k = 100 / rect.width; // client px -> SVG units
      setCursor({ x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [tracking]);

  const active = tracking ? cursor : null;
  const asleep = state === "sleepy";
  const happy = state === "happy";

  return (
    <div
      className="mascot"
      data-state={state}
      data-reduced-motion={reduced}
      role="img"
      aria-label={LABELS[state]}
      style={{ width: size, height: size }}
    >
      <svg ref={svgRef} viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
        <ellipse className="mascot-shadow" cx="50" cy="90" rx="26" ry="4" />
        <g className="mascot-body">
          <path className="mascot-blob" d="M50 22c20 0 34 14 34 33 0 17-13 28-34 28S16 72 16 55c0-19 14-33 34-33z" />
          {happy && (
            <>
              <ellipse className="mascot-cheek" cx="30" cy="62" rx="4" ry="3" />
              <ellipse className="mascot-cheek" cx="70" cy="62" rx="4" ry="3" />
            </>
          )}
          {[LEFT_EYE, RIGHT_EYE].map((eye, i) => {
            if (happy) {
              return <path key={i} className="mascot-eye-happy" d={`M${eye.x - 5} ${eye.y + 2}q5 -7 10 0`} />;
            }
            const off = pupilOffset(eye, active, 4);
            return (
              <g
                key={i}
                className={`mascot-eye${asleep ? " sleepy" : ""}`}
                style={{ transformOrigin: `${eye.x}px ${eye.y}px` }}
              >
                <ellipse cx={eye.x} cy={eye.y} rx="5" ry="7" className="mascot-eye-white" />
                <circle cx={eye.x + off.x * 0.5} cy={eye.y + off.y * 0.5} r="3" className="mascot-pupil" />
              </g>
            );
          })}
        </g>
        {state === "thinking" && (
          <g className="mascot-bubble" data-testid="thinking-bubble">
            <rect x="2" y="2" width="30" height="16" rx="8" />
            <circle className="dot d1" cx="11" cy="10" r="2.2" />
            <circle className="dot d2" cx="17" cy="10" r="2.2" />
            <circle className="dot d3" cx="23" cy="10" r="2.2" />
          </g>
        )}
        {happy && (
          <g className="mascot-sparkles" data-testid="sparkles">
            <path d="M82 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
            <path d="M14 30l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" />
          </g>
        )}
        {asleep && (
          <text className="mascot-zzz" x="72" y="26" fontSize="12">
            z
          </text>
        )}
      </svg>
      {(badge || state === "new-change") && <span className="mascot-badge" data-testid="badge" />}
    </div>
  );
}
