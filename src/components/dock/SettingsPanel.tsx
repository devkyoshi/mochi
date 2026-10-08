import type { AppConfig } from "../../lib/api";
import { ClaudeConnect } from "../chat/ClaudeConnect";
import { GlobalRuleSetup } from "../integration/GlobalRuleSetup";

interface SettingsPanelProps {
  config: AppConfig;
  error: string | null;
  onChange: (patch: Partial<AppConfig>) => void;
}

export function SettingsPanel({ config, error, onChange }: SettingsPanelProps) {
  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={config.autoCollapse}
          onChange={(e) => onChange({ autoCollapse: e.target.checked })}
          className="h-4 w-4 accent-sky-400"
        />
        Collapse when I click elsewhere
      </label>
      <p className="text-neutral-400">
        Show/hide shortcut: <kbd className="rounded bg-white/10 px-1.5 py-0.5">{config.hotkey}</kbd>
      </p>
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={config.autoApply}
          onChange={(e) => onChange({ autoApply: e.target.checked })}
          className="h-4 w-4 accent-sky-400"
        />
        Apply Claude&rsquo;s proposed edits without asking
      </label>
      <details className="rounded-lg bg-white/5 p-2">
        <summary className="cursor-pointer text-neutral-300">
          Claude: {config.claudeProvider === "cli" ? "Claude Code" : config.claudeProvider === "api" ? "API key" : "not connected"}
        </summary>
        <div className="mt-2">
          <ClaudeConnect connected={config.claudeProvider} onConnected={(claudeProvider) => onChange({ claudeProvider })} />
        </div>
      </details>
      <details className="rounded-lg bg-white/5 p-2">
        <summary className="cursor-pointer text-neutral-300">Claude Code integration (global rule and hooks)</summary>
        <div className="mt-2">
          <GlobalRuleSetup opsPath={config.opsMemoryPath} />
        </div>
      </details>
      <p className="truncate text-neutral-400">Ops Memory: {config.opsMemoryPath ?? "not set"}</p>
      <button
        type="button"
        onClick={() => onChange({ setupComplete: false })}
        className="rounded-full bg-white/10 px-3 py-1 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-sky-400"
      >
        Re-run setup
      </button>
      {error && (
        <p role="alert" className="text-amber-300">
          {error}
        </p>
      )}
    </div>
  );
}
