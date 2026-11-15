import type { Rect } from '../../types';
import type { DockSide, DropTarget } from './dock-layout';
import { DEFAULT_DOCK_SIZES, MAX_TABS_PER_GROUP } from './dock-layout';

/**
 * Pure hit-testing for drag-and-drop docking. All coordinates are host-local
 * (relative to the dock host's top-left). The interaction layer captures DOM
 * rects once at drag start and feeds them here on every pointer move.
 */

export interface DropZoneGroup {
  groupId: string;
  rect: Rect;
  isFloating: boolean;
  tabCount: number;
}

export interface DropZones {
  /** The dock host bounds, host-local (x/y are 0). */
  hostRect: Rect;
  /** Floating groups must precede docked ones, ordered top-most first. */
  groups: DropZoneGroup[];
}

/** Pointer distance from a host edge that triggers edge docking. */
export const EDGE_DOCK_BAND = 28;
/** Height fraction at the bottom of a group that reorders below it. */
const BELOW_BAND_RATIO = 1 / 3;

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

function nearestSide(x: number, y: number, rect: Rect): DockSide {
  const distances: Record<DockSide, number> = {
    left: (x - rect.x) / rect.width,
    right: (rect.x + rect.width - x) / rect.width,
    top: (y - rect.y) / rect.height,
    bottom: (rect.y + rect.height - y) / rect.height,
  };
  let best: DockSide = 'left';
  for (const side of ['right', 'top', 'bottom'] as const) {
    if (distances[side] < distances[best]) best = side;
  }
  return best;
}

/**
 * Which region of a group rect the pointer is over. By convention a panel's
 * tab bar sits at its top, so dropping over the upper portion combines the
 * dragged panel into the group as a tab ('center'); only the bottom band
 * reorders it below the group in the stack ('bottom').
 */
export function groupRegionAt(_x: number, y: number, rect: Rect): 'center' | DockSide {
  const belowThreshold = rect.y + rect.height * (1 - BELOW_BAND_RATIO);
  return y >= belowThreshold ? 'bottom' : 'center';
}

/**
 * Resolve the drop target under the pointer. Returns null when the drop
 * would float the panel (open space, or a floating window that can't accept
 * more tabs).
 */
export function resolveDropTarget(x: number, y: number, zones: DropZones): DropTarget | null {
  for (const group of zones.groups) {
    if (!group.isFloating || !contains(group.rect, x, y)) continue;
    if (group.tabCount >= MAX_TABS_PER_GROUP) return null;
    return { kind: 'group', groupId: group.groupId, region: 'center' };
  }

  for (const group of zones.groups) {
    if (group.isFloating || !contains(group.rect, x, y)) continue;
    let region = groupRegionAt(x, y, group.rect);
    if (region === 'center' && group.tabCount >= MAX_TABS_PER_GROUP) {
      region = nearestSide(x, y, group.rect);
    }
    return { kind: 'group', groupId: group.groupId, region };
  }

  const host = zones.hostRect;
  if (contains(host, x, y)) {
    const distances: Record<DockSide, number> = {
      left: x - host.x,
      right: host.x + host.width - x,
      top: y - host.y,
      bottom: host.y + host.height - y,
    };
    let best: DockSide = 'left';
    for (const side of ['right', 'top', 'bottom'] as const) {
      if (distances[side] < distances[best]) best = side;
    }
    if (distances[best] <= EDGE_DOCK_BAND) return { kind: 'edge', side: best };
  }

  return null;
}

/**
 * The highlight rect to render for a drop target, host-local. Null for
 * floating drops (the drag ghost is the preview).
 */
export function dropIndicatorRect(target: DropTarget | null, zones: DropZones): Rect | null {
  if (!target) return null;
  const host = zones.hostRect;
  if (target.kind === 'edge') {
    const size = {
      left: Math.min(DEFAULT_DOCK_SIZES.left, host.width * 0.4),
      right: Math.min(DEFAULT_DOCK_SIZES.right, host.width * 0.4),
      top: Math.min(DEFAULT_DOCK_SIZES.top, host.height * 0.4),
      bottom: Math.min(DEFAULT_DOCK_SIZES.bottom, host.height * 0.4),
    }[target.side];
    switch (target.side) {
      case 'left':
        return { x: host.x, y: host.y, width: size, height: host.height };
      case 'right':
        return { x: host.x + host.width - size, y: host.y, width: size, height: host.height };
      case 'top':
        return { x: host.x, y: host.y, width: host.width, height: size };
      case 'bottom':
        return { x: host.x, y: host.y + host.height - size, width: host.width, height: size };
    }
  }
  if (target.kind === 'group') {
    const group = zones.groups.find((g) => g.groupId === target.groupId);
    if (!group) return null;
    const { rect } = group;
    switch (target.region) {
      case 'center':
        return rect;
      case 'left':
        return { ...rect, width: rect.width / 2 };
      case 'right':
        return { ...rect, x: rect.x + rect.width / 2, width: rect.width / 2 };
      case 'top':
        return { ...rect, height: rect.height / 2 };
      case 'bottom':
        return { ...rect, y: rect.y + rect.height / 2, height: rect.height / 2 };
    }
  }
  return null;
}
