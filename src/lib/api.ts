import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { withAutoCollapseSuspended } from "./dock/autoCollapseGuard";

export type ClaudeProviderKind = "cli" | "api";

/** Mirrors `AppConfig` in src-tauri/src/config.rs. */
export interface AppConfig {
  hotkey: string;
  autoCollapse: boolean;
  monitor: string | null;
  sound: boolean;
  opsMemoryPath: string | null;
  setupComplete: boolean;
  claudeProvider: ClaudeProviderKind | null;
  autoApply: boolean;
  staleDays: number;
  sleepyMinutes: number;
  launchAtLogin: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  hotkey: "CommandOrControl+Shift+Space",
  autoCollapse: true,
  monitor: null,
  sound: true,
  opsMemoryPath: null,
  setupComplete: false,
  claudeProvider: null,
  autoApply: false,
  staleDays: 30,
  sleepyMinutes: 10,
  launchAtLogin: false,
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
  const chosen = await withAutoCollapseSuspended(() => open({ directory: true, multiple: false }));
  return typeof chosen === "string" ? chosen : null;
};

/** Validate a candidate directory; resolves to the final path or rejects with a user-readable message. */
export const validateOpsDirectory = (path: string, createNew: boolean): Promise<string> =>
  invoke<string>("validate_ops_directory", { path, createNew });

/** Scaffold the Ops Memory layout and git repo. */
export const setupOpsMemory = (path: string, createNew: boolean): Promise<SetupResult> =>
  invoke<SetupResult>("setup_ops_memory", { path, createNew });

export interface FileInfo {
  path: string;
  size: number;
}

/** Result of saving a file. `blocked` carries redacted secret findings and nothing was written. */
export type WriteOutcome =
  | { status: "saved"; commit: string }
  | { status: "unchanged" }
  | { status: "blocked"; findings: { kind: string; line: number; preview: string }[] };

export interface HistoryEntry {
  commit: string;
  subject: string;
  date: string;
}

export const listOpsFiles = (): Promise<FileInfo[]> => invoke<FileInfo[]>("list_ops_files");

export const readOpsFile = (path: string): Promise<string> => invoke<string>("read_ops_file", { path });

export const writeOpsFile = (path: string, content: string, message: string): Promise<WriteOutcome> =>
  invoke<WriteOutcome>("write_ops_file", { path, content, message });

/** Revert the latest commit; resolves to the revert's short hash. */
export const undoLastChange = (): Promise<string> => invoke<string>("undo_last_change");

export const opsHistory = (path: string | null, limit: number): Promise<HistoryEntry[]> =>
  invoke<HistoryEntry[]>("ops_history", { path, limit });

/** Subscribe to external edits of Ops Memory files (relative paths). Resolves to an unsubscribe function. */
export const onOpsChanged = (callback: (paths: string[]) => void): Promise<() => void> =>
  listen<string[]>("ops://changed", (e) => callback(e.payload));

/** Save several files as one commit (all or nothing). */
export const writeOpsFiles = (files: { path: string; content: string }[], message: string): Promise<WriteOutcome> =>
  invoke<WriteOutcome>("write_ops_files", { files, message });

/** Mirrors `StreamEvent` in src-tauri/src/claude.rs. */
export type StreamEvent = { type: "text"; text: string } | { type: "done" } | { type: "error"; message: string };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const claudeSend = (requestId: string, system: string, messages: ChatMessage[]): Promise<void> =>
  invoke<void>("claude_send", { requestId, system, messages });

export const claudeCancel = (requestId: string): Promise<void> => invoke<void>("claude_cancel", { requestId });

/** Test a provider with a tiny request; resolves to the reply text. */
export const claudeTest = (provider: ClaudeProviderKind): Promise<string> => invoke<string>("claude_test", { provider });

/** Store the API key in the OS keychain (it is never read back into the UI). */
export const claudeSaveKey = (key: string): Promise<void> => invoke<void>("claude_save_key", { key });
export const claudeHasKey = (): Promise<boolean> => invoke<boolean>("claude_has_key");
export const claudeDeleteKey = (): Promise<void> => invoke<void>("claude_delete_key");

/** Dev-login passwords live in the OS keychain under `devlogin:<name>:<username>`; markdown never holds them. */
export const secretSet = (account: string, value: string): Promise<void> => invoke<void>("secret_set", { account, value });
export const secretHas = (account: string): Promise<boolean> => invoke<boolean>("secret_has", { account });
/** Only called from an explicit Copy/Reveal click. */
export const secretGet = (account: string): Promise<string> => invoke<string>("secret_get", { account });
export const secretDelete = (account: string): Promise<void> => invoke<void>("secret_delete", { account });

export const onClaudeStream = (requestId: string, callback: (e: StreamEvent) => void): Promise<() => void> =>
  listen<StreamEvent>(`claude://${requestId}`, (e) => callback(e.payload));

/** Mirrors `InstallPlan` in src-tauri/src/install.rs (a dry run of the Claude Code integration). */
export interface InstallPlan {
  settingsPath: string;
  claudeMdPath: string;
  settingsBefore: string | null;
  settingsAfter: string;
  claudeMdBefore: string | null;
  claudeMdAfter: string;
  commandPath?: string;
  commandBefore?: string | null;
  /** `null` = the command file is removed. */
  commandAfter?: string | null;
  unchanged: boolean;
}

export interface IntegrationStatus {
  ruleInstalled: boolean;
  stopHook: boolean;
  sessionEndHook: boolean;
  /** The `/mochi-sync` slash command is installed. */
  commandInstalled?: boolean;
  /** Installed rule or command differs from this version of Mochi (run update). */
  outdated?: boolean;
  settingsError: string | null;
}

export interface InstallResult {
  backups: string[];
  status: IntegrationStatus;
}

/** Dry run only: nothing is written. `opsPath` overrides the saved folder (used by the setup wizard). */
export const integrationPreview = (uninstall: boolean, opsPath?: string): Promise<InstallPlan> =>
  invoke<InstallPlan>("integration_preview", { uninstall, opsPathOverride: opsPath ?? null });

export const integrationInstall = (opsPath?: string): Promise<InstallResult> =>
  invoke<InstallResult>("integration_install", { opsPathOverride: opsPath ?? null });

export const integrationUninstall = (): Promise<InstallResult> => invoke<InstallResult>("integration_uninstall");

export const integrationStatus = (): Promise<IntegrationStatus> => invoke<IntegrationStatus>("integration_status");

/** Turn launch-at-login on or off in the operating system (only call from an explicit user action). */
export const setLaunchAtLogin = (enabled: boolean): Promise<void> => invoke<void>("set_launch_at_login", { enabled });
