import type { Rect } from '../../types';

/**
 * Pure layout-tree model for the dockable panel system.
 *
 * The layout is four edge docks — each holding a tree of splits and tab
 * groups — plus a list of floating windows (each a single tab group with a
 * host-local rect). Every function is immutable: it returns a new layout and
 * never mutates its input. No DOM, no React.
 */

export type DockSide = 'left' | 'right' | 'top' | 'bottom';
export type SplitDirection = 'row' | 'column';

export interface TabGroupNode {
  kind: 'tabs';
  id: string;
  /** Panel ids, 1..MAX_TABS_PER_GROUP. */
  tabs: string[];
  activeTab: string;
}

export interface SplitNode {
  kind: 'split';
  id: string;
  direction: SplitDirection;
  /** Always ≥ 2 after normalization. */
  children: LayoutNode[];
  /** Fractions of the main axis, same length as children, sum ≈ 1. */
  sizes: number[];
}

export type LayoutNode = TabGroupNode | SplitNode;

export interface FloatingWindow {
  /** Doubles as the tab-group id for drop targeting. */
  id: string;
  tabs: string[];
  activeTab: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DockLayout {
  docks: Record<DockSide, LayoutNode | null>;
  /** Main-axis size in px: width for left/right docks, height for top/bottom. */
  dockSizes: Record<DockSide, number>;
  /** Render order is z-order — the last window paints on top. */
  floating: FloatingWindow[];
}

export type DropTarget =
  | { kind: 'edge'; side: DockSide }
  | { kind: 'group'; groupId: string; region: 'center' | DockSide }
  | { kind: 'float'; rect: Rect };

export const MAX_TABS_PER_GROUP = 3;
export const DOCK_MIN_SIZE = 160;
export const DOCK_MAX_SIZE = 800;
export const FLOAT_MIN_WIDTH = 200;
export const FLOAT_MIN_HEIGHT = 140;
export const SPLIT_MIN_PANE_PX = 90;

export const DOCK_SIDES: readonly DockSide[] = ['left', 'right', 'top', 'bottom'];

export const DEFAULT_DOCK_SIZES: Record<DockSide, number> = {
  left: 280,
  right: 312,
  top: 220,
  bottom: 220,
};

/** Side docks stack panels vertically; top/bottom docks stack horizontally. */
export function dockStackDirection(side: DockSide): SplitDirection {
  return side === 'left' || side === 'right' ? 'column' : 'row';
}

function newNodeId(): string {
  return crypto.randomUUID();
}

export function createTabGroup(tabs: string[], activeTab?: string): TabGroupNode {
  const first = tabs[0];
  if (!first) throw new Error('createTabGroup requires at least one tab');
  return {
    kind: 'tabs',
    id: newNodeId(),
    tabs: [...tabs],
    activeTab: activeTab !== undefined && tabs.includes(activeTab) ? activeTab : first,
  };
}

export function emptyLayout(): DockLayout {
  return {
    docks: { left: null, right: null, top: null, bottom: null },
    dockSizes: { ...DEFAULT_DOCK_SIZES },
    floating: [],
  };
}

/** Mirrors the pre-dock sidebar: Color above Layers on the right edge. */
export function createDefaultLayout(): DockLayout {
  const layout = emptyLayout();
  return {
    ...layout,
    docks: {
      ...layout.docks,
      right: {
        kind: 'split',
        id: newNodeId(),
        direction: 'column',
        children: [createTabGroup(['color']), createTabGroup(['layers'])],
        sizes: [0.35, 0.65],
      },
    },
  };
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function collectGroups(node: LayoutNode | null): TabGroupNode[] {
  if (!node) return [];
  if (node.kind === 'tabs') return [node];
  return node.children.flatMap((child) => collectGroups(child));
}

export function panelsInLayout(layout: DockLayout): string[] {
  const ids: string[] = [];
  for (const side of DOCK_SIDES) {
    for (const group of collectGroups(layout.docks[side])) ids.push(...group.tabs);
  }
  for (const window of layout.floating) ids.push(...window.tabs);
  return ids;
}

export interface GroupLocation {
  id: string;
  tabs: string[];
  activeTab: string;
  place: 'dock' | 'floating';
  side?: DockSide;
}

export function findGroup(layout: DockLayout, groupId: string): GroupLocation | null {
  for (const side of DOCK_SIDES) {
    for (const group of collectGroups(layout.docks[side])) {
      if (group.id === groupId) {
        return { id: group.id, tabs: group.tabs, activeTab: group.activeTab, place: 'dock', side };
      }
    }
  }
  const window = layout.floating.find((w) => w.id === groupId);
  if (window) {
    return { id: window.id, tabs: window.tabs, activeTab: window.activeTab, place: 'floating' };
  }
  return null;
}

export function findPanelGroupId(layout: DockLayout, panelId: string): string | null {
  for (const side of DOCK_SIDES) {
    for (const group of collectGroups(layout.docks[side])) {
      if (group.tabs.includes(panelId)) return group.id;
    }
  }
  const window = layout.floating.find((w) => w.tabs.includes(panelId));
  return window ? window.id : null;
}

// ─── Normalization ──────────────────────────────────────────────────────────

function renormalize(sizes: number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0) return sizes.map(() => 1 / sizes.length);
  return sizes.map((s) => s / sum);
}

/**
 * Collapse single-child splits, flatten nested same-direction splits, drop
 * empty groups, and repair active tabs. Returns null for an empty subtree.
 */
export function normalizeNode(node: LayoutNode): LayoutNode | null {
  if (node.kind === 'tabs') {
    const first = node.tabs[0];
    if (!first) return null;
    if (!node.tabs.includes(node.activeTab)) return { ...node, activeTab: first };
    return node;
  }
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.forEach((child, i) => {
    const normalized = normalizeNode(child);
    if (!normalized) return;
    const size = node.sizes[i] ?? 0;
    if (normalized.kind === 'split' && normalized.direction === node.direction) {
      normalized.children.forEach((grandchild, j) => {
        children.push(grandchild);
        sizes.push(size * (normalized.sizes[j] ?? 0));
      });
    } else {
      children.push(normalized);
      sizes.push(size);
    }
  });
  const only = children[0];
  if (!only) return null;
  if (children.length === 1) return only;
  return { ...node, children, sizes: renormalize(sizes) };
}

function normalizeLayout(layout: DockLayout): DockLayout {
  const docks = {} as Record<DockSide, LayoutNode | null>;
  for (const side of DOCK_SIDES) {
    const node = layout.docks[side];
    docks[side] = node ? normalizeNode(node) : null;
  }
  const floating = layout.floating
    .filter((w) => w.tabs.length > 0)
    .map((w) => {
      const first = w.tabs[0];
      if (!first || w.tabs.includes(w.activeTab)) return w;
      return { ...w, activeTab: first };
    });
  return { ...layout, docks, floating };
}

// ─── Removal ────────────────────────────────────────────────────────────────

function removePanelFromNode(node: LayoutNode, panelId: string): LayoutNode | null {
  if (node.kind === 'tabs') {
    if (!node.tabs.includes(panelId)) return node;
    const tabs = node.tabs.filter((t) => t !== panelId);
    const first = tabs[0];
    if (!first) return null;
    return { ...node, tabs, activeTab: node.activeTab === panelId ? first : node.activeTab };
  }
  let changed = false;
  const mapped = node.children.map((child) => {
    const next = removePanelFromNode(child, panelId);
    if (next !== child) changed = true;
    return next;
  });
  if (!changed) return node;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  mapped.forEach((child, i) => {
    if (!child) return;
    children.push(child);
    sizes.push(node.sizes[i] ?? 0);
  });
  const only = children[0];
  if (!only) return null;
  if (children.length === 1) return only;
  return { ...node, children, sizes: renormalize(sizes) };
}

export function removePanel(layout: DockLayout, panelId: string): DockLayout {
  let changed = false;
  const docks = {} as Record<DockSide, LayoutNode | null>;
  for (const side of DOCK_SIDES) {
    const prev = layout.docks[side];
    const next = prev ? removePanelFromNode(prev, panelId) : null;
    docks[side] = next;
    if (next !== prev) changed = true;
  }
  const floating: FloatingWindow[] = [];
  for (const window of layout.floating) {
    if (!window.tabs.includes(panelId)) {
      floating.push(window);
      continue;
    }
    changed = true;
    const tabs = window.tabs.filter((t) => t !== panelId);
    const first = tabs[0];
    if (!first) continue;
    const activeTab = window.activeTab === panelId ? first : window.activeTab;
    floating.push({ ...window, tabs, activeTab });
  }
  if (!changed) return layout;
  return { ...layout, docks, floating };
}

// ─── Insertion ──────────────────────────────────────────────────────────────

function replaceGroupInNode(
  node: LayoutNode,
  groupId: string,
  replacement: LayoutNode,
): LayoutNode {
  if (node.kind === 'tabs') {
    return node.id === groupId ? replacement : node;
  }
  let changed = false;
  const children = node.children.map((child) => {
    const next = replaceGroupInNode(child, groupId, replacement);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

function appendToDock(layout: DockLayout, side: DockSide, node: TabGroupNode): DockLayout {
  const root = layout.docks[side];
  if (!root) {
    return { ...layout, docks: { ...layout.docks, [side]: node } };
  }
  const direction = dockStackDirection(side);
  if (root.kind === 'split' && root.direction === direction) {
    const fraction = 1 / (root.children.length + 1);
    const sizes = [...root.sizes.map((s) => s * (1 - fraction)), fraction];
    const children = [...root.children, node];
    return { ...layout, docks: { ...layout.docks, [side]: { ...root, children, sizes } } };
  }
  const split: SplitNode = {
    kind: 'split',
    id: newNodeId(),
    direction,
    children: [root, node],
    sizes: [0.65, 0.35],
  };
  return { ...layout, docks: { ...layout.docks, [side]: split } };
}

function mergeTabsIntoGroup(
  layout: DockLayout,
  groupId: string,
  node: TabGroupNode,
): DockLayout {
  const incoming = node.tabs;
  for (const side of DOCK_SIDES) {
    const root = layout.docks[side];
    if (!root) continue;
    for (const group of collectGroups(root)) {
      if (group.id !== groupId) continue;
      const tabs = [...group.tabs, ...incoming.filter((t) => !group.tabs.includes(t))];
      if (tabs.length > MAX_TABS_PER_GROUP) return layout;
      const merged: TabGroupNode = { ...group, tabs, activeTab: node.activeTab };
      return {
        ...layout,
        docks: { ...layout.docks, [side]: replaceGroupInNode(root, groupId, merged) },
      };
    }
  }
  const windowIndex = layout.floating.findIndex((w) => w.id === groupId);
  const window = layout.floating[windowIndex];
  if (window) {
    const tabs = [...window.tabs, ...incoming.filter((t) => !window.tabs.includes(t))];
    if (tabs.length > MAX_TABS_PER_GROUP) return layout;
    const floating = [...layout.floating];
    floating[windowIndex] = { ...window, tabs, activeTab: node.activeTab };
    return { ...layout, floating };
  }
  return layout;
}

function splitGroupWithNode(
  layout: DockLayout,
  groupId: string,
  region: DockSide,
  node: TabGroupNode,
): DockLayout {
  for (const side of DOCK_SIDES) {
    const root = layout.docks[side];
    if (!root) continue;
    const target = collectGroups(root).find((g) => g.id === groupId);
    if (!target) continue;
    const direction: SplitDirection = region === 'left' || region === 'right' ? 'row' : 'column';
    const before = region === 'left' || region === 'top';
    const split: SplitNode = {
      kind: 'split',
      id: newNodeId(),
      direction,
      children: before ? [node, target] : [target, node],
      sizes: [0.5, 0.5],
    };
    const replaced = replaceGroupInNode(root, groupId, split);
    return normalizeLayout({ ...layout, docks: { ...layout.docks, [side]: replaced } });
  }
  return layout;
}

function clampFloatRect(rect: Rect): Rect {
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(FLOAT_MIN_WIDTH, rect.width),
    height: Math.max(FLOAT_MIN_HEIGHT, rect.height),
  };
}

/**
 * Insert a detached tab group at a drop target. The group's tabs must not be
 * anywhere in the layout already (remove/detach first).
 */
export function insertNode(layout: DockLayout, node: TabGroupNode, target: DropTarget): DockLayout {
  if (target.kind === 'edge') {
    return appendToDock(layout, target.side, node);
  }
  if (target.kind === 'group') {
    if (target.region === 'center') return mergeTabsIntoGroup(layout, target.groupId, node);
    return splitGroupWithNode(layout, target.groupId, target.region, node);
  }
  const rect = clampFloatRect(target.rect);
  const window: FloatingWindow = {
    id: node.id,
    tabs: node.tabs,
    activeTab: node.activeTab,
    ...rect,
  };
  return { ...layout, floating: [...layout.floating, window] };
}

// ─── Moves ──────────────────────────────────────────────────────────────────

export function setActiveTab(layout: DockLayout, groupId: string, panelId: string): DockLayout {
  for (const side of DOCK_SIDES) {
    const root = layout.docks[side];
    if (!root) continue;
    const group = collectGroups(root).find((g) => g.id === groupId);
    if (!group) continue;
    if (!group.tabs.includes(panelId) || group.activeTab === panelId) return layout;
    const replaced = replaceGroupInNode(root, groupId, { ...group, activeTab: panelId });
    return { ...layout, docks: { ...layout.docks, [side]: replaced } };
  }
  const index = layout.floating.findIndex((w) => w.id === groupId);
  const window = layout.floating[index];
  if (!window || !window.tabs.includes(panelId) || window.activeTab === panelId) return layout;
  const floating = [...layout.floating];
  floating[index] = { ...window, activeTab: panelId };
  return { ...layout, floating };
}

/**
 * Move a single panel to a drop target. Handles self-drops: dropping a tab on
 * its own group's center just activates it; splitting a group by its only tab
 * is a no-op.
 */
export function movePanel(layout: DockLayout, panelId: string, target: DropTarget): DockLayout {
  const sourceGroupId = findPanelGroupId(layout, panelId);
  if (!sourceGroupId) return layout;

  if (target.kind === 'group') {
    const location = findGroup(layout, target.groupId);
    if (!location) return layout;
    if (target.region === 'center') {
      if (location.tabs.includes(panelId)) return setActiveTab(layout, target.groupId, panelId);
      if (location.tabs.length >= MAX_TABS_PER_GROUP) return layout;
    } else if (target.groupId === sourceGroupId && location.tabs.length <= 1) {
      return layout;
    }
  }

  const removed = removePanel(layout, panelId);
  // Removal may have dissolved the target group (it held only this panel).
  if (target.kind === 'group' && !findGroup(removed, target.groupId)) return layout;
  return normalizeLayout(insertNode(removed, createTabGroup([panelId]), target));
}

/** Dock an entire floating window (all its tabs) at a drop target. */
export function dockFloatingWindow(
  layout: DockLayout,
  windowId: string,
  target: DropTarget,
): DockLayout {
  const window = layout.floating.find((w) => w.id === windowId);
  if (!window) return layout;
  if (target.kind === 'group') {
    if (target.groupId === windowId) return layout;
    const location = findGroup(layout, target.groupId);
    if (!location) return layout;
    const incoming = window.tabs.filter((t) => !location.tabs.includes(t)).length;
    if (target.region === 'center' && location.tabs.length + incoming > MAX_TABS_PER_GROUP) {
      return layout;
    }
  }
  const without: DockLayout = {
    ...layout,
    floating: layout.floating.filter((w) => w.id !== windowId),
  };
  const node: TabGroupNode = {
    kind: 'tabs',
    id: window.id,
    tabs: window.tabs,
    activeTab: window.activeTab,
  };
  return normalizeLayout(insertNode(without, node, target));
}

// ─── Floating window geometry ───────────────────────────────────────────────

export function moveFloatingWindow(
  layout: DockLayout,
  windowId: string,
  x: number,
  y: number,
): DockLayout {
  const index = layout.floating.findIndex((w) => w.id === windowId);
  const window = layout.floating[index];
  if (!window || (window.x === x && window.y === y)) return layout;
  const floating = [...layout.floating];
  floating[index] = { ...window, x, y };
  return { ...layout, floating };
}

export function resizeFloatingWindow(
  layout: DockLayout,
  windowId: string,
  rect: Rect,
): DockLayout {
  const index = layout.floating.findIndex((w) => w.id === windowId);
  const window = layout.floating[index];
  if (!window) return layout;
  const floating = [...layout.floating];
  floating[index] = { ...window, ...clampFloatRect(rect) };
  return { ...layout, floating };
}

export function bringFloatingToFront(layout: DockLayout, windowId: string): DockLayout {
  const index = layout.floating.findIndex((w) => w.id === windowId);
  const window = layout.floating[index];
  if (!window || index === layout.floating.length - 1) return layout;
  const floating = layout.floating.filter((w) => w.id !== windowId);
  floating.push(window);
  return { ...layout, floating };
}

/** Keep at least a grabbable strip of the window inside the host. */
export function clampFloatingToHost(
  layout: DockLayout,
  hostWidth: number,
  hostHeight: number,
): DockLayout {
  const MARGIN = 48;
  let changed = false;
  const floating = layout.floating.map((w) => {
    const x = Math.min(Math.max(w.x, MARGIN - w.width), Math.max(0, hostWidth - MARGIN));
    const y = Math.min(Math.max(w.y, 0), Math.max(0, hostHeight - MARGIN));
    if (x === w.x && y === w.y) return w;
    changed = true;
    return { ...w, x, y };
  });
  return changed ? { ...layout, floating } : layout;
}

// ─── Resizing ───────────────────────────────────────────────────────────────

export type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Resize a rect by dragging one of its edges/corners by (dx, dy). Opposite
 * edges stay pinned; min-size clamping eats into the dragged edge only.
 */
export function applyWindowResize(rect: Rect, dir: ResizeDir, dx: number, dy: number): Rect {
  let { x, y, width, height } = rect;
  if (dir.includes('e')) width = Math.max(FLOAT_MIN_WIDTH, rect.width + dx);
  if (dir.includes('w')) {
    const clamped = Math.max(FLOAT_MIN_WIDTH, rect.width - dx);
    x = rect.x + (rect.width - clamped);
    width = clamped;
  }
  if (dir.includes('s')) height = Math.max(FLOAT_MIN_HEIGHT, rect.height + dy);
  if (dir.includes('n')) {
    const clamped = Math.max(FLOAT_MIN_HEIGHT, rect.height - dy);
    y = rect.y + (rect.height - clamped);
    height = clamped;
  }
  return { x, y, width, height };
}

export function setDockSize(layout: DockLayout, side: DockSide, px: number): DockLayout {
  const clamped = Math.min(DOCK_MAX_SIZE, Math.max(DOCK_MIN_SIZE, Math.round(px)));
  if (layout.dockSizes[side] === clamped) return layout;
  return { ...layout, dockSizes: { ...layout.dockSizes, [side]: clamped } };
}

/**
 * Shift the divider at `dividerIndex` (between child i and i+1) by
 * `deltaFraction`, clamping so neither pane shrinks below `minFraction`.
 */
export function applySplitDrag(
  sizes: readonly number[],
  dividerIndex: number,
  deltaFraction: number,
  minFraction: number,
): number[] {
  const a = sizes[dividerIndex];
  const b = sizes[dividerIndex + 1];
  if (a === undefined || b === undefined) return [...sizes];
  const lo = Math.min(0, -(a - minFraction));
  const hi = Math.max(0, b - minFraction);
  const delta = Math.min(hi, Math.max(lo, deltaFraction));
  const next = [...sizes];
  next[dividerIndex] = a + delta;
  next[dividerIndex + 1] = b - delta;
  return next;
}

export function setSplitSizes(layout: DockLayout, splitId: string, sizes: number[]): DockLayout {
  const replaceSplit = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'tabs') return node;
    if (node.id === splitId && node.sizes.length === sizes.length) {
      return { ...node, sizes: renormalize(sizes) };
    }
    let changed = false;
    const children = node.children.map((child) => {
      const next = replaceSplit(child);
      if (next !== child) changed = true;
      return next;
    });
    return changed ? { ...node, children } : node;
  };
  for (const side of DOCK_SIDES) {
    const root = layout.docks[side];
    if (!root) continue;
    const next = replaceSplit(root);
    if (next !== root) {
      return { ...layout, docks: { ...layout.docks, [side]: next } };
    }
  }
  return layout;
}

// ─── Default placement ──────────────────────────────────────────────────────

/**
 * Add a panel that isn't in the layout at its canonical spot: stacked into
 * the right dock, ordered by `canonicalOrder` (a panel toolbar toggle, not a
 * drag). Existing groups keep their arrangement.
 */
export function addPanelToDefaultLocation(
  layout: DockLayout,
  panelId: string,
  canonicalOrder: readonly string[],
): DockLayout {
  if (panelsInLayout(layout).includes(panelId)) return layout;
  const group = createTabGroup([panelId]);
  const right = layout.docks.right;
  if (!right) {
    return { ...layout, docks: { ...layout.docks, right: group } };
  }
  const rankOf = (id: string | undefined): number => {
    const index = id === undefined ? -1 : canonicalOrder.indexOf(id);
    return index === -1 ? canonicalOrder.length : index;
  };
  const nodeRank = (node: LayoutNode): number => rankOf(collectGroups(node)[0]?.tabs[0]);
  const myRank = rankOf(panelId);

  if (right.kind === 'split' && right.direction === 'column') {
    const foundIndex = right.children.findIndex((child) => nodeRank(child) > myRank);
    const insertAt = foundIndex === -1 ? right.children.length : foundIndex;
    const fraction = 1 / (right.children.length + 1);
    const sizes = right.sizes.map((s) => s * (1 - fraction));
    sizes.splice(insertAt, 0, fraction);
    const children = [...right.children];
    children.splice(insertAt, 0, group);
    return { ...layout, docks: { ...layout.docks, right: { ...right, children, sizes } } };
  }

  const before = nodeRank(right) > myRank;
  const split: SplitNode = {
    kind: 'split',
    id: newNodeId(),
    direction: 'column',
    children: before ? [group, right] : [right, group],
    sizes: before ? [0.3, 0.7] : [0.7, 0.3],
  };
  return { ...layout, docks: { ...layout.docks, right: split } };
}
