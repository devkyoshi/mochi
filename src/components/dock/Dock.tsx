import { useEffect } from "react";
import { useDock } from "../../lib/dock/useDock";
import { useOpsMemory } from "../../lib/ops/useOpsMemory";
import { countReviewStubs } from "../../lib/opsMemory";
import { QuickAdd } from "../add/QuickAdd";
import { Browse } from "../browse/Browse";
import { Chat } from "../chat/Chat";
import { Home } from "../home/Home";
import { MascotDevPanel } from "../mascot";
import { Wizard } from "../wizard/Wizard";
import { Pill } from "./Pill";
import { SettingsPanel } from "./SettingsPanel";
import { TabBar } from "./TabBar";

export default function Dock() {
  const { state, config, error, loaded, send, updateConfig } = useDock();
  const { expanded, tab } = state;
  const needsSetup = loaded && !config.setupComplete;
  const ops = useOpsMemory(loaded && config.setupComplete);
  const reviewStubs = countReviewStubs(ops.files.find((f) => f.path === "inbox.md")?.content ?? "");

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
            <section role="tabpanel" className="m-4 mt-3 min-h-0 flex-1 overflow-auto rounded-2xl bg-white/5 p-4 text-neutral-300">
              {tab === "settings" ? (
                <SettingsPanel config={config} error={error} onChange={(p) => void updateConfig(p)} />
              ) : tab === "home" ? (
                <Home
                  data={ops}
                  loading={ops.loading}
                  error={ops.error}
                  externalChange={ops.externalChange}
                  changedPaths={ops.changedPaths}
                  reviewStubs={reviewStubs}
                  onDismissChange={ops.clearExternalChange}
                >
                  {import.meta.env.DEV && (
                    <div className="mt-3">
                      <MascotDevPanel />
                    </div>
                  )}
                </Home>
              ) : tab === "browse" ? (
                <Browse data={ops} runSearch={ops.runSearch} reload={ops.reload} />
              ) : tab === "add" ? (
                <QuickAdd files={ops.files} entries={ops.entries} onSaved={() => void ops.reload()} />
              ) : (
                <Chat
                  files={ops.files}
                  claudeProvider={config.claudeProvider}
                  autoApply={config.autoApply}
                  onApplied={() => void ops.reload()}
                  onOpenSettings={() => send({ type: "selectTab", tab: "settings" })}
                />
              )}
            </section>
          </>
        ) : (
          <Pill onClick={() => send({ type: "expand" })} hasNewChange={ops.externalChange} needsReview={reviewStubs > 0} />
        )}
      </div>
    </div>
  );
}
