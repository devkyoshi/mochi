export type TabId = "home" | "browse" | "chat" | "add" | "settings";

export interface DockState {
  expanded: boolean;
  tab: TabId;
  autoCollapse: boolean;
}

export type DockAction =
  | { type: "toggle" }
  | { type: "expand" }
  | { type: "collapse" }
  /** The window lost focus. */
  | { type: "blur" }
  | { type: "selectTab"; tab: TabId }
  | { type: "setAutoCollapse"; value: boolean };

export const initialDockState: DockState = { expanded: false, tab: "home", autoCollapse: true };

/** Pure reducer for the dock's UI state. Returns the same object when nothing changes. */
export function dockReducer(state: DockState, action: DockAction): DockState {
  switch (action.type) {
    case "toggle":
      return { ...state, expanded: !state.expanded };
    case "expand":
      return state.expanded ? state : { ...state, expanded: true };
    case "collapse":
      return state.expanded ? { ...state, expanded: false } : state;
    case "blur":
      return state.autoCollapse && state.expanded ? { ...state, expanded: false } : state;
    case "selectTab":
      return state.tab === action.tab ? state : { ...state, tab: action.tab };
    case "setAutoCollapse":
      return state.autoCollapse === action.value ? state : { ...state, autoCollapse: action.value };
  }
}
