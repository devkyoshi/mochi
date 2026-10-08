export const MASCOT_STATES = ["idle", "curious", "thinking", "happy", "alert", "sleepy", "new-change"] as const;
export type MascotState = (typeof MASCOT_STATES)[number];

export interface Point {
  x: number;
  y: number;
}

/**
 * Pupil offset (in SVG units, capped at `maxOffset`) so the eye looks from `eyeCenter` toward `cursor`.
 * Both points are in the same coordinate space. Returns {0,0} when there is no cursor or it is on the eye.
 */
export function pupilOffset(eyeCenter: Point, cursor: Point | null, maxOffset: number): Point {
  if (!cursor) return { x: 0, y: 0 };
  const dx = cursor.x - eyeCenter.x;
  const dy = cursor.y - eyeCenter.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return { x: 0, y: 0 };
  // Ease in: nearby cursors move the pupil less than far ones.
  const scale = Math.min(dist / 120, 1) * maxOffset;
  return { x: (dx / dist) * scale, y: (dy / dist) * scale };
}
