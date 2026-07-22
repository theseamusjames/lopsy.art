import { create } from 'zustand';
import type { Rect } from '../../types';
import type { DockLayout, DockSide, DropTarget } from './dock-layout';
import {
  addPanelToDefaultLocation,
  bringFloatingToFront,
  clampFloatingToHost,
  createDefaultLayout,
  dockFloatingWindow,
  emptyLayout,
  findGroup,
  findPanelGroupId,
  movePanel,
  moveFloatingWindow,
  panelsInLayout,
  removePanel,
  resizeFloatingWindow,
  setActiveTab,
  setDockSize,
  setSplitSizes,
} from './dock-layout';
import { loadPersistedLayout, savePersistedLayout } from './dock-persist';
import { DOCK_PANEL_IDS, DOCK_STACK_ORDER, getPanelTitle } from './panel-registry';
import { publishVisiblePanels, setPanelToggleHandler } from './dock-ui-bridge';

export type DockDragSource =
  | { kind: 'tab'; panelId: string; groupId: string }
  | { kind: 'window'; windowId: string };

export interface DockDragState {
  source: DockDragSource;
  /** Pointer position, host-local px — drives the drag ghost. */
  pointer: { x: number; y: number };
  /** Resolved drop target under the pointer; null means "float on drop". */
  target: DropTarget | null;
  /** Host-local highlight rect for the current target, if any. */
  indicator: Rect | null;
  /** Title shown in the drag ghost. */
  title: string;
  /** Tab drags show a ghost chip; window drags move the real window. */
  showGhost: boolean;
}

interface DockState {
  layout: DockLayout;
  /** Non-null while a dock drag is in progress (drives ghost + indicator). */
  drag: DockDragState | null;
  /**
   * Toolbar toggle: absent → add at default spot; present but not the
   * active tab of its group → activate; active → close.
   */
  togglePanel: (panelId: string) => void;
  /** Ensure a panel is open and its tab active (e.g. "show the color panel"). */
  revealPanel: (panelId: string) => void;
  closePanel: (panelId: string) => void;
  activateTab: (groupId: string, panelId: string) => void;
  setDrag: (drag: DockDragState | null) => void;
  dropTab: (panelId: string, target: DropTarget) => void;
  dropWindow: (windowId: string, target: DropTarget) => void;
  moveWindow: (windowId: string, x: number, y: number) => void;
  resizeWindow: (windowId: string, rect: Rect) => void;
  focusWindow: (windowId: string) => void;
  resizeSplit: (splitId: string, sizes: number[]) => void;
  resizeDock: (side: DockSide, px: number) => void;
  /** Pull stray floating windows back inside the host after it shrinks. */
  clampToHost: (width: number, height: number) => void;
  resetLayout: () => void;
}

function createInitialLayout(): DockLayout {
  if (typeof window !== 'undefined') {
    const persisted = loadPersistedLayout(DOCK_PANEL_IDS);
    if (persisted) return persisted;
    if (window.matchMedia('(pointer: coarse)').matches) return emptyLayout();
  }
  return createDefaultLayout();
}

// null until the first publish, so the initial reconcile always fires even
// when the booted layout is empty (ui-store's own guess may differ).
let lastVisibleKey: string | null = null;

function syncVisiblePanelsMirror(layout: DockLayout): void {
  const panels = panelsInLayout(layout);
  // Geometry drags (move/resize a window, drag a splitter) commit a new
  // layout every pointer frame but never change *which* panels are open.
  // Skip the publish when the set is unchanged so visiblePanels subscribers
  // (PanelToolbar) don't re-render 60×/sec during a drag.
  const key = [...panels].sort().join(',');
  if (key === lastVisibleKey) return;
  lastVisibleKey = key;
  publishVisiblePanels(new Set(panels));
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersist: DockLayout | null = null;

function schedulePersist(layout: DockLayout): void {
  pendingPersist = layout;
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (pendingPersist) savePersistedLayout(pendingPersist);
    pendingPersist = null;
  }, 400);
}

function flushPersist(): void {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (pendingPersist) savePersistedLayout(pendingPersist);
  pendingPersist = null;
}

export const useDockStore = create<DockState>((set, get) => {
  const commitLayout = (next: DockLayout): void => {
    if (next === get().layout) return;
    set({ layout: next });
    syncVisiblePanelsMirror(next);
    schedulePersist(next);
  };

  return {
    layout: createInitialLayout(),
    drag: null,

    togglePanel: (panelId) => {
      const { layout } = get();
      const groupId = findPanelGroupId(layout, panelId);
      if (groupId === null) {
        commitLayout(addPanelToDefaultLocation(layout, panelId, DOCK_STACK_ORDER));
        return;
      }
      const group = findGroup(layout, groupId);
      if (group && group.activeTab !== panelId) {
        commitLayout(setActiveTab(layout, groupId, panelId));
        return;
      }
      commitLayout(removePanel(layout, panelId));
    },

    revealPanel: (panelId) => {
      const { layout } = get();
      const groupId = findPanelGroupId(layout, panelId);
      if (groupId === null) {
        commitLayout(addPanelToDefaultLocation(layout, panelId, DOCK_STACK_ORDER));
        return;
      }
      let next = setActiveTab(layout, groupId, panelId);
      const group = findGroup(next, groupId);
      if (group?.place === 'floating') next = bringFloatingToFront(next, groupId);
      commitLayout(next);
    },

    closePanel: (panelId) => {
      commitLayout(removePanel(get().layout, panelId));
    },

    activateTab: (groupId, panelId) => {
      commitLayout(setActiveTab(get().layout, groupId, panelId));
    },

    setDrag: (drag) => set({ drag }),

    dropTab: (panelId, target) => {
      commitLayout(movePanel(get().layout, panelId, target));
    },

    dropWindow: (windowId, target) => {
      commitLayout(dockFloatingWindow(get().layout, windowId, target));
    },

    moveWindow: (windowId, x, y) => {
      commitLayout(moveFloatingWindow(get().layout, windowId, x, y));
    },

    resizeWindow: (windowId, rect) => {
      commitLayout(resizeFloatingWindow(get().layout, windowId, rect));
    },

    focusWindow: (windowId) => {
      commitLayout(bringFloatingToFront(get().layout, windowId));
    },

    resizeSplit: (splitId, sizes) => {
      commitLayout(setSplitSizes(get().layout, splitId, sizes));
    },

    resizeDock: (side, px) => {
      commitLayout(setDockSize(get().layout, side, px));
    },

    clampToHost: (width, height) => {
      commitLayout(clampFloatingToHost(get().layout, width, height));
    },

    resetLayout: () => {
      commitLayout(createDefaultLayout());
    },
  };
});

setPanelToggleHandler((panelId) => useDockStore.getState().togglePanel(panelId));

// Publish the boot layout's panel set (persisted layouts can differ from
// ui-store's own initial guess); the bridge caches it if ui-store hasn't
// registered its sink yet.
syncVisiblePanelsMirror(useDockStore.getState().layout);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPersist);
}

/** Title for the drag ghost — exported for the drag controller. */
export function dragTitleFor(source: DockDragSource, layout: DockLayout): string {
  if (source.kind === 'tab') return getPanelTitle(source.panelId);
  const window = layout.floating.find((w) => w.id === source.windowId);
  const first = window?.tabs[0];
  return first ? getPanelTitle(first) : '';
}
