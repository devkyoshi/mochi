import { useRef, type KeyboardEvent, type ReactNode } from "react";
import type { TabId } from "../../lib/dock/dockState";
import { BrowseIcon, ChatIcon, GearIcon, HomeIcon, PlusIcon, SoundOffIcon, SoundOnIcon } from "./Icons";

interface TabBarProps {
  tab: TabId;
  sound: boolean;
  onSelect: (tab: TabId) => void;
  onToggleSound: () => void;
}

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <HomeIcon /> },
  { id: "browse", label: "Browse", icon: <BrowseIcon /> },
  { id: "chat", label: "Chat", icon: <ChatIcon /> },
  { id: "add", label: "Quick add", icon: <PlusIcon /> },
  { id: "settings", label: "Settings", icon: <GearIcon /> },
];

/** Index of the tab to move to for an arrow/Home/End key, or `null` for other keys. */
export function nextTabIndex(current: number, key: string, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

const buttonClass = (active: boolean) =>
  `flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
    active ? "bg-white/15 text-white" : "text-neutral-400 hover:bg-white/10 hover:text-white"
  }`;

export function TabBar({ tab, sound, onSelect, onToggleSound }: TabBarProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    const next = nextTabIndex(index, e.key, TABS.length);
    if (next === null) return;
    e.preventDefault();
    onSelect(TABS[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div className="flex items-center justify-between px-4 pt-3">
      <div role="tablist" aria-label="Sections" className="flex gap-1">
        {TABS.map(({ id, label, icon }, i) => (
          <button
            key={id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            aria-label={label}
            title={label}
            aria-selected={tab === id}
            tabIndex={tab === id ? 0 : -1}
            className={buttonClass(tab === id)}
            onClick={() => onSelect(id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {icon}
          </button>
        ))}
      </div>
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
  );
}
