import type { ReactNode } from "react";
import type { TabId } from "../../lib/dock/dockState";
import { ChatIcon, GearIcon, HomeIcon, PlusIcon, SoundOffIcon, SoundOnIcon } from "./Icons";

interface TabBarProps {
  tab: TabId;
  sound: boolean;
  onSelect: (tab: TabId) => void;
  onToggleSound: () => void;
}

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <HomeIcon /> },
  { id: "chat", label: "Chat", icon: <ChatIcon /> },
  { id: "add", label: "Quick add", icon: <PlusIcon /> },
];

const buttonClass = (active: boolean) =>
  `flex h-9 w-9 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-sky-400 ${
    active ? "bg-white/15 text-white" : "text-neutral-400 hover:bg-white/10 hover:text-white"
  }`;

export function TabBar({ tab, sound, onSelect, onToggleSound }: TabBarProps) {
  return (
    <div className="flex items-center justify-between px-4 pt-3">
      <div role="tablist" aria-label="Sections" className="flex gap-1">
        {TABS.map(({ id, label, icon }) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-label={label}
            title={label}
            aria-selected={tab === id}
            className={buttonClass(tab === id)}
            onClick={() => onSelect(id)}
          >
            {icon}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          role="tab"
          aria-label="Settings"
          title="Settings"
          aria-selected={tab === "settings"}
          className={buttonClass(tab === "settings")}
          onClick={() => onSelect("settings")}
        >
          <GearIcon />
        </button>
        <button
          type="button"
          aria-label={sound ? "Mute sounds" : "Unmute sounds"}
          title={sound ? "Mute sounds" : "Unmute sounds"}
          aria-pressed={!sound}
          className={buttonClass(false)}
          onClick={onToggleSound}
        >
          {sound ? <SoundOnIcon /> : <SoundOffIcon />}
        </button>
      </div>
    </div>
  );
}
