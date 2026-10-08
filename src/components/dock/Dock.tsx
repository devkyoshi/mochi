import { useEffect } from "react";
import { useDock } from "../../lib/dock/useDock";
import { Wizard } from "../wizard/Wizard";
import type { TabId } from "../../lib/dock/dockState";
import { MascotDevPanel } from "../mascot";
import { Pill } from "./Pill";
import { SettingsPanel } from "./SettingsPanel";
import { TabBar } from "./TabBar";

const PLACEHOLDERS: Record<Exclude<TabId, "settings">, string> = {
  home: "Your VMs and recent changes will appear here.",
  chat: "Ask Claude about your Ops Memory.",
  add: "Quickly log a change or note.",
};

export default function Dock() {
  const { state, config, error, loaded, send, updateConfig } = useDock();
  const { expanded, tab } = state;
  const needsSetup = loaded && !config.setupComplete;

  // First run: open the dock straight into the setup wizard.
  useEffect(() => {
    if (needsSetup) send({ type: "expand" });
  }, [needsSetup, send]);

  return (
    <div className="flex h-screen w-screen items-start justify-center overflow-hidden">
      <div
        data-testid="dock"
        data-expanded={expanded}
        className="dock flex flex-col overflow-hidden bg-neutral-900/95 text-neutral-100 shadow-lg ring-1 ring-white/10"
      >
        {expanded && needsSetup ? (
          <Wizard onFinish={updateConfig} />
        ) : expanded ? (
          <>
            <TabBar
              tab={tab}
              sound={config.sound}
              onSelect={(t) => send({ type: "selectTab", tab: t })}
              onToggleSound={() => void updateConfig({ sound: !config.sound })}
            />
            <section role="tabpanel" className="m-4 mt-3 flex-1 rounded-2xl bg-white/5 p-4 text-neutral-300">
              {tab === "settings" ? (
                <SettingsPanel config={config} error={error} onChange={(p) => void updateConfig(p)} />
              ) : (
                <>
                  <p>{PLACEHOLDERS[tab]}</p>
                  {import.meta.env.DEV && tab === "home" && (
                    <div className="mt-3">
                      <MascotDevPanel />
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        ) : (
          <Pill onClick={() => send({ type: "expand" })} />
        )}
      </div>
    </div>
  );
}
