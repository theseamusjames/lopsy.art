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
 * Mint a stable id for a persisted node/window: reuse the incoming id only if
 * it's a non-empty string that hasn't already been claimed elsewhere in the
 * layout; otherwise generate a fresh one. This guarantees every node/window
 * id is unique — the tree ops (replaceGroupInNode replaces *every* matching
 * id, the element registry keys by id) rely on that invariant, and a crafted
 * or corrupted payload must not be able to violate it.
 */
function uniqueId(raw: unknown, usedIds: Set<string>): string {
  const id = typeof raw === 'string' && raw.length > 0 && !usedIds.has(raw) ? raw : crypto.randomUUID();
  usedIds.add(id);
  return id;
}

/** Smallest fraction a persisted split pane may hold, so it never collapses. */
const MIN_SPLIT_FRACTION = 0.05;

/**
 * Validate a node tree. `seen` accumulates panel ids across the whole layout
 * so a panel can never appear twice (first occurrence wins); `usedIds`
 * accumulates node ids so no two nodes/windows share one.
 */
function sanitizeNode(
  raw: unknown,
  knownPanels: readonly string[],
  seen: Set<string>,
  usedIds: Set<string>,
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
    const group: TabGroupNode = { kind: 'tabs', id: uniqueId(raw.id, usedIds), tabs, activeTab };
    return group;
  }
  if (raw.kind === 'split') {
    if (!Array.isArray(raw.children)) return null;
    const direction = raw.direction === 'row' ? 'row' : 'column';
    const rawSizes = Array.isArray(raw.sizes) ? raw.sizes : [];
    const children: LayoutNode[] = [];
    const sizes: number[] = [];
    raw.children.forEach((child, i) => {
      const node = sanitizeNode(child, knownPanels, seen, usedIds);
      if (!node) return;
      children.push(node);
      const size = rawSizes[i];
      // Floor every pane to a small positive share so a persisted 0 (or a
      // negative/NaN) can't yield a pane the flexbox renderer collapses away.
      sizes.push(typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : MIN_SPLIT_FRACTION);
    });
    const only = children[0];
    if (!only) return null;
    if (children.length === 1) return only;
    const sum = sizes.reduce((a, b) => a + b, 0);
    const normalized = sum > 0 ? sizes.map((s) => s / sum) : sizes.map(() => 1 / sizes.length);
    const split: SplitNode = { kind: 'split', id: uniqueId(raw.id, usedIds), direction, children, sizes: normalized };
    return split;
  }
  return null;
}

function sanitizeFloating(
  raw: unknown,
  knownPanels: readonly string[],
  seen: Set<string>,
  usedIds: Set<string>,
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
    id: uniqueId(raw.id, usedIds),
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
  const usedIds = new Set<string>();
  const docks = {} as Record<DockSide, LayoutNode | null>;
  for (const side of DOCK_SIDES) {
    const node = sanitizeNode(raw.docks[side], knownPanels, seen, usedIds);
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
      const window = sanitizeFloating(entry, knownPanels, seen, usedIds);
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
