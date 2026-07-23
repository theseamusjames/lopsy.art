import { Columns3, History, Info, Layers, Map, Palette, Spline, Type } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Panels that participate in the docking system. */
export type DockablePanelId =
  | 'navigator'
  | 'info'
  | 'color'
  | 'layers'
  | 'channels'
  | 'history'
  | 'paths'
  | 'text';

export interface DockPanelMeta {
  id: DockablePanelId;
  title: string;
  icon: LucideIcon;
}

/** Toolbar display order. */
export const DOCK_PANELS: readonly DockPanelMeta[] = [
  { id: 'navigator', title: 'Navigator', icon: Map },
  { id: 'info', title: 'Info', icon: Info },
  { id: 'color', title: 'Color', icon: Palette },
  { id: 'layers', title: 'Layers', icon: Layers },
  { id: 'channels', title: 'Channels', icon: Columns3 },
  { id: 'history', title: 'History', icon: History },
  { id: 'paths', title: 'Paths', icon: Spline },
  { id: 'text', title: 'Text', icon: Type },
];

export const DOCK_PANEL_IDS: readonly string[] = DOCK_PANELS.map((p) => p.id);

/**
 * Vertical stacking order for toolbar-toggled panels joining the right dock.
 * Layers sits last so it lands at the bottom, mirroring the old sidebar.
 */
export const DOCK_STACK_ORDER: readonly string[] = [
  'navigator',
  'info',
  'color',
  'text',
  'channels',
  'history',
  'paths',
  'layers',
];

export function getPanelMeta(id: string): DockPanelMeta | undefined {
  return DOCK_PANELS.find((p) => p.id === id);
}

export function getPanelTitle(id: string): string {
  return getPanelMeta(id)?.title ?? id;
}
