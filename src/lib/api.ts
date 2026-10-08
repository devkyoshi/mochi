import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

/** Mirrors `AppConfig` in src-tauri/src/config.rs. */
export interface AppConfig {
  hotkey: string;
  autoCollapse: boolean;
  monitor: string | null;
  sound: boolean;
  opsMemoryPath: string | null;
  setupComplete: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  hotkey: "CommandOrControl+Shift+Space",
  autoCollapse: true,
  monitor: null,
  sound: true,
  opsMemoryPath: null,
  setupComplete: false,
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

/** Mirrors `SetupResult` in src-tauri/src/ops.rs. */
export interface SetupResult {
  path: string;
  gitInitialized: boolean;
  created: string[];
}

/** Native folder picker. Resolves to null if cancelled. */
export const pickFolder = async (): Promise<string | null> => {
  const chosen = await open({ directory: true, multiple: false });
  return typeof chosen === "string" ? chosen : null;
};

/** Validate a candidate directory; resolves to the final path or rejects with a user-readable message. */
export const validateOpsDirectory = (path: string, createNew: boolean): Promise<string> =>
  invoke<string>("validate_ops_directory", { path, createNew });

/** Scaffold the Ops Memory layout and git repo. */
export const setupOpsMemory = (path: string, createNew: boolean): Promise<SetupResult> =>
  invoke<SetupResult>("setup_ops_memory", { path, createNew });
