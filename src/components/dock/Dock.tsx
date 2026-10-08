import { useEffect, useMemo, useRef, useState } from "react";
import { useDock } from "../../lib/dock/useDock";
import { useOpsMemory } from "../../lib/ops/useOpsMemory";
import { useIdle } from "../../lib/idle";
import { useSound } from "../../lib/sound";
import { computeStats, countReviewStubs, todayIso } from "../../lib/opsMemory";
import { QuickAdd } from "../add/QuickAdd";
import { Browse } from "../browse/Browse";
import { Chat } from "../chat/Chat";
import { Digest } from "../home/Digest";
import { Directory } from "../directory/Directory";
import { Home } from "../home/Home";
import { Inbox } from "../inbox/Inbox";
import { MascotDevPanel } from "../mascot";
import { Wizard } from "../wizard/Wizard";
import { Pill, pillState } from "./Pill";
import { SettingsPanel } from "./SettingsPanel";
import { TabBar } from "./TabBar";

export default function Dock() {
  const { state, config, error, loaded, send, updateConfig } = useDock();
  const { expanded, tab } = state;
  const needsSetup = loaded && !config.setupComplete;
  const ops = useOpsMemory(loaded && config.setupComplete);
  const reviewStubs = countReviewStubs(ops.files.find((f) => f.path === "inbox.md")?.content ?? "");

  const stale = useMemo(
    () => computeStats(ops.entries, todayIso(), config.staleDays).stale,
    [ops.entries, config.staleDays],
  );
  const [picked, setPicked] = useState<{ vm?: string; project?: string }>({});
  const open = (kind: "vm" | "project", name: string) => {
    setPicked((p) => ({ ...p, [kind]: name }));
    send({ type: "selectTab", tab: kind === "vm" ? "vms" : "projects" });
  };
  const alert = reviewStubs > 0 || stale.length > 0;
  const sleepy = useIdle(config.sleepyMinutes * 60_000, loaded && !expanded);
  const play = useSound(config.sound);

  // Soft chirps when something new needs attention.
  const seen = useRef({ stubs: 0, change: false });
  useEffect(() => {
    if (reviewStubs > seen.current.stubs) play("alert");
    else if (ops.externalChange && !seen.current.change) play("change");
    seen.current = { stubs: reviewStubs, change: ops.externalChange };
  }, [reviewStubs, ops.externalChange, play]);

  // Escape closes the panel.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") send({ type: "collapse" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, send]);

  // First run: open the dock straight into the setup wizard.
  useEffect(() => {
    if (needsSetup) send({ type: "expand" });
  }, [needsSetup, send]);

  return (
    <div className="flex h-screen w-screen items-start justify-center overflow-hidden">
      <main
        aria-label="Mochi"
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
              badges={{ inbox: reviewStubs }}
              onSelect={(t) => send({ type: "selectTab", tab: t })}
              onToggleSound={() => void updateConfig({ sound: !config.sound })}
            />
            <section
              role="tabpanel"
              className={`m-4 mt-3 min-h-0 flex-1 rounded-2xl bg-white/5 p-4 text-neutral-300 ${["browse", "projects", "vms"].includes(tab) ? "overflow-hidden" : "overflow-auto"}`}
            >
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
                  staleDays={config.staleDays}
                  onDismissChange={ops.clearExternalChange}
                  onOpenInbox={() => send({ type: "selectTab", tab: "inbox" })}
                >
                  <Digest files={ops.files} claudeProvider={config.claudeProvider} />
                  {import.meta.env.DEV && (
                    <div className="mt-3">
                      <MascotDevPanel />
                    </div>
                  )}
                </Home>
              ) : tab === "browse" ? (
                <Browse data={ops} runSearch={ops.runSearch} reload={ops.reload} />
              ) : tab === "projects" || tab === "vms" ? (
                <Directory
                  key={tab}
                  kind={tab === "vms" ? "vm" : "project"}
                  files={ops.files}
                  selected={tab === "vms" ? picked.vm : picked.project}
                  onSelect={(name) => setPicked((p) => ({ ...p, [tab === "vms" ? "vm" : "project"]: name }))}
                  onOpen={open}
                />
              ) : tab === "inbox" ? (
                <Inbox files={ops.files} />
              ) : tab === "add" ? (
                <QuickAdd
                  files={ops.files}
                  onSaved={() => {
                    play("happy");
                    void ops.reload();
                  }}
                />
              ) : (
                <Chat
                  files={ops.files}
                  claudeProvider={config.claudeProvider}
                  autoApply={config.autoApply}
                  onApplied={() => {
                    play("happy");
                    void ops.reload();
                  }}
                  onOpenSettings={() => send({ type: "selectTab", tab: "settings" })}
                />
              )}
            </section>
          </>
        ) : (
          <Pill
            onClick={() => send({ type: "expand" })}
            mascotState={pillState({ alert, newChange: ops.externalChange, sleepy })}
          />
        )}
      </main>
    </div>
  );
}
