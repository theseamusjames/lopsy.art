import type {
  DockLayout,
  DockSide,
  FloatingWindow,
  LayoutNode,
  SplitNode,
  TabGroupNode,
} from './dock-layout';
import {
  DOCK_MAX_SIZE,
  DOCK_MIN_SIZE,
  DOCK_SIDES,
  DEFAULT_DOCK_SIZES,
  FLOAT_MIN_HEIGHT,
  FLOAT_MIN_WIDTH,
  MAX_TABS_PER_GROUP,
  normalizeNode,
} from './dock-layout';

/**
 * Serialization and defensive re-validation of persisted layouts. Persisted
 * data is untrusted: it may come from an older version, a corrupted write,
 * or hand editing. `sanitizeLayout` either returns a structurally valid
 * layout or null (caller falls back to the default).
 */

export const DOCK_LAYOUT_STORAGE_KEY = 'dock:layout:v1';

export function serializeLayout(layout: DockLayout): string {
  return JSON.stringify(layout);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function sanitizeNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Validate a node tree. `seen` accumulates panel ids across the whole
 * layout so a panel can never appear twice (first occurrence wins).
 */
function sanitizeNode(
  raw: unknown,
  knownPanels: readonly string[],
  seen: Set<string>,
): LayoutNode | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === 'tabs') {
    if (!Array.isArray(raw.tabs)) return null;
    const tabs: string[] = [];
    for (const tab of raw.tabs) {
      if (typeof tab !== 'string' || !knownPanels.includes(tab) || seen.has(tab)) continue;
      if (tabs.length >= MAX_TABS_PER_GROUP) break;
      seen.add(tab);
      tabs.push(tab);
    }
    const first = tabs[0];
    if (!first) return null;
    const activeTab =
      typeof raw.activeTab === 'string' && tabs.includes(raw.activeTab) ? raw.activeTab : first;
    const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : crypto.randomUUID();
    const group: TabGroupNode = { kind: 'tabs', id, tabs, activeTab };
    return group;
  }
  if (raw.kind === 'split') {
    if (!Array.isArray(raw.children)) return null;
    const direction = raw.direction === 'row' ? 'row' : 'column';
    const rawSizes = Array.isArray(raw.sizes) ? raw.sizes : [];
    const children: LayoutNode[] = [];
    const sizes: number[] = [];
    raw.children.forEach((child, i) => {
      const node = sanitizeNode(child, knownPanels, seen);
      if (!node) return;
      children.push(node);
      const size = rawSizes[i];
      sizes.push(typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 0);
    });
    const only = children[0];
    if (!only) return null;
    if (children.length === 1) return only;
    const sum = sizes.reduce((a, b) => a + b, 0);
    const normalized = sum > 0 ? sizes.map((s) => s / sum) : sizes.map(() => 1 / sizes.length);
    const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : crypto.randomUUID();
    const split: SplitNode = { kind: 'split', id, direction, children, sizes: normalized };
    return split;
  }
  return null;
}

function sanitizeFloating(
  raw: unknown,
  knownPanels: readonly string[],
  seen: Set<string>,
): FloatingWindow | null {
  if (!isRecord(raw) || !Array.isArray(raw.tabs)) return null;
  const tabs: string[] = [];
  for (const tab of raw.tabs) {
    if (typeof tab !== 'string' || !knownPanels.includes(tab) || seen.has(tab)) continue;
    if (tabs.length >= MAX_TABS_PER_GROUP) break;
    seen.add(tab);
    tabs.push(tab);
  }
  const first = tabs[0];
  if (!first) return null;
  const activeTab =
    typeof raw.activeTab === 'string' && tabs.includes(raw.activeTab) ? raw.activeTab : first;
  return {
    id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : crypto.randomUUID(),
    tabs,
    activeTab,
    x: sanitizeNumber(raw.x, -10_000, 10_000, 0),
    y: sanitizeNumber(raw.y, 0, 10_000, 0),
    width: sanitizeNumber(raw.width, FLOAT_MIN_WIDTH, 4_000, 300),
    height: sanitizeNumber(raw.height, FLOAT_MIN_HEIGHT, 4_000, 300),
  };
}

export function sanitizeLayout(raw: unknown, knownPanels: readonly string[]): DockLayout | null {
  if (!isRecord(raw) || !isRecord(raw.docks)) return null;
  const seen = new Set<string>();
  const docks = {} as Record<DockSide, LayoutNode | null>;
  for (const side of DOCK_SIDES) {
    const node = sanitizeNode(raw.docks[side], knownPanels, seen);
    docks[side] = node ? normalizeNode(node) : null;
  }
  const rawSizes = isRecord(raw.dockSizes) ? raw.dockSizes : {};
  const dockSizes = {} as Record<DockSide, number>;
  for (const side of DOCK_SIDES) {
    dockSizes[side] = sanitizeNumber(
      rawSizes[side],
      DOCK_MIN_SIZE,
      DOCK_MAX_SIZE,
      DEFAULT_DOCK_SIZES[side],
    );
  }
  const floating: FloatingWindow[] = [];
  if (Array.isArray(raw.floating)) {
    for (const entry of raw.floating) {
      const window = sanitizeFloating(entry, knownPanels, seen);
      if (window) floating.push(window);
    }
  }
  return { docks, dockSizes, floating };
}

export function loadPersistedLayout(knownPanels: readonly string[]): DockLayout | null {
  try {
    const raw = localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY);
    if (raw === null) return null;
    return sanitizeLayout(JSON.parse(raw), knownPanels);
  } catch {
    return null;
  }
}

export function savePersistedLayout(layout: DockLayout): void {
  try {
    localStorage.setItem(DOCK_LAYOUT_STORAGE_KEY, serializeLayout(layout));
  } catch {
    // localStorage may be unavailable (private mode, quota) — layout just
    // won't persist across reloads.
  }
}
