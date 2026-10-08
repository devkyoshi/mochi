import { useEffect, useState } from "react";

/** Pure: has `thresholdMs` passed since `lastActivity`? */
export function isIdle(lastActivity: number, now: number, thresholdMs: number): boolean {
  return now - lastActivity >= thresholdMs;
}

const EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "focus"] as const;

/**
 * True after `thresholdMs` without user activity in the window. Any pointer/keyboard activity
 * wakes it. Disabled (always false) when `enabled` is false.
 */
export function useIdle(thresholdMs: number, enabled = true): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let last = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (isIdle(last, Date.now(), thresholdMs)) setIdle(true);
        else schedule();
      }, Math.max(thresholdMs - (Date.now() - last), 1));
    };
    const onActivity = () => {
      last = Date.now();
      setIdle(false);
      schedule();
    };

    EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    schedule();
    return () => {
      clearTimeout(timer);
      EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
    };
  }, [thresholdMs, enabled]);

  return enabled && idle;
}
