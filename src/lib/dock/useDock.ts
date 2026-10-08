import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import * as api from "../api";
import { dockReducer, initialDockState, type DockAction } from "./dockState";

/** How long the CSS collapse animation runs before the OS window is shrunk. */
export const COLLAPSE_DELAY_MS = 200;

/** Owns the dock's UI state, keeps the OS window in sync, and wires backend events. */
export function useDock() {
  const [state, dispatch] = useReducer(dockReducer, initialDockState);
  const [config, setConfigState] = useState<api.AppConfig>(api.DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const followCursor = useRef(false);

  // Load persisted settings.
  useEffect(() => {
    let alive = true;
    api
      .getConfig()
      .then((c) => {
        if (!alive) return;
        setConfigState(c);
        dispatch({ type: "setAutoCollapse", value: c.autoCollapse });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Hotkey and blur events from the backend.
  useEffect(() => {
    let cancelled = false;
    let unlisten: Array<() => void> = [];
    Promise.all([
      api.onDockEvent("toggle", () => {
        followCursor.current = true;
        dispatch({ type: "toggle" });
      }),
      api.onDockEvent("blur", () => dispatch({ type: "blur" })),
    ])
      .then((fns) => {
        if (cancelled) fns.forEach((f) => f());
        else unlisten = fns;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten.forEach((f) => f());
    };
  }, []);

  // Keep the OS window in sync. Expanding resizes first (the CSS animates into it);
  // collapsing waits for the CSS animation before shrinking the window.
  useEffect(() => {
    if (state.expanded) {
      const follow = followCursor.current;
      followCursor.current = false;
      api.setDockState(true, follow).catch((e) => setError(String(e)));
      return;
    }
    const timer = setTimeout(() => {
      api.setDockState(false, false).catch((e) => setError(String(e)));
    }, COLLAPSE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.expanded]);

  /** Persist a settings change. Resolves to an error message, or null on success. */
  const updateConfig = useCallback(
    async (patch: Partial<api.AppConfig>): Promise<string | null> => {
      try {
        const saved = await api.setConfig({ ...config, ...patch });
        setConfigState(saved);
        dispatch({ type: "setAutoCollapse", value: saved.autoCollapse });
        setError(null);
        return null;
      } catch (e) {
        const message = String(e);
        setError(message);
        return message;
      }
    },
    [config],
  );

  const send = useCallback((action: DockAction) => dispatch(action), []);

  return { state, config, error, send, updateConfig };
}
