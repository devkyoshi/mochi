import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Mirrors `AppConfig` in src-tauri/src/config.rs. */
export interface AppConfig {
  hotkey: string;
  autoCollapse: boolean;
  monitor: string | null;
  sound: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  hotkey: "CommandOrControl+Shift+Space",
  autoCollapse: true,
  monitor: null,
  sound: true,
};

export const getConfig = (): Promise<AppConfig> => invoke<AppConfig>("get_config");

export const setConfig = (config: AppConfig): Promise<AppConfig> => invoke<AppConfig>("set_config", { config });

/** Resize/move the dock window. `followCursor` puts it on the monitor under the cursor. */
export const setDockState = (expanded: boolean, followCursor: boolean): Promise<void> =>
  invoke<void>("set_dock_state", { expanded, followCursor });

export type DockEvent = "toggle" | "blur";

/** Subscribe to dock events from the backend. Resolves to an unsubscribe function. */
export const onDockEvent = (event: DockEvent, callback: () => void): Promise<() => void> =>
  listen(`dock://${event}`, () => callback());
