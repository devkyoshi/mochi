import type { AppConfig } from "../../lib/api";

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
      {error && (
        <p role="alert" className="text-amber-300">
          {error}
        </p>
      )}
    </div>
  );
}
