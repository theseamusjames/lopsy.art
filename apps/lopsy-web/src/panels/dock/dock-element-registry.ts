import type { DockLayout } from './dock-layout';
import { collectGroups, DOCK_SIDES } from './dock-layout';
import type { DropZoneGroup, DropZones } from './drop-zones';

/**
 * Live DOM elements for drag hit-testing. Tab groups and the dock host
 * register themselves on mount; the drag controller snapshots their rects
 * once at drag start (host-local coordinates).
 */

const groupElements = new Map<string, HTMLElement>();
let hostElement: HTMLElement | null = null;

// Subscribers are notified when host/group elements register or unregister,
// so hooks that measure the dock DOM (e.g. useDockedPanelAnchor) can
// re-measure once elements become available. Registration happens later than
// the ancestor's first useLayoutEffect when the parent conditionally renders
// the dock (during app boot), so we can't rely on effect ordering alone.
const listeners = new Set<() => void>();

function notify(): void {
  for (const cb of listeners) cb();
}

export function subscribeElementChanges(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function registerGroupElement(groupId: string, el: HTMLElement): void {
  groupElements.set(groupId, el);
  notify();
}

export function unregisterGroupElement(groupId: string): void {
  if (groupElements.delete(groupId)) notify();
}

export function setHostElement(el: HTMLElement | null): void {
  if (hostElement === el) return;
  hostElement = el;
  notify();
}

export function getHostElement(): HTMLElement | null {
  return hostElement;
}

/**
 * Snapshot host-local drop zones for the current layout. Floating windows
 * come first (top-most first) so hit-testing respects z-order; `exclude`
 * omits the group being dragged.
 */
export function captureDropZones(
  layout: DockLayout,
  exclude?: string,
): { zones: DropZones; hostOrigin: { x: number; y: number } } | null {
  if (!hostElement) return null;
  const hostRect = hostElement.getBoundingClientRect();
  const toLocal = (el: HTMLElement): DOMRect => el.getBoundingClientRect();

  const groups: DropZoneGroup[] = [];
  for (let i = layout.floating.length - 1; i >= 0; i--) {
    const window = layout.floating[i];
    if (!window || window.id === exclude) continue;
    const el = groupElements.get(window.id);
    if (!el) continue;
    const rect = toLocal(el);
    groups.push({
      groupId: window.id,
      rect: {
        x: rect.left - hostRect.left,
        y: rect.top - hostRect.top,
        width: rect.width,
        height: rect.height,
      },
      isFloating: true,
      tabCount: window.tabs.length,
    });
  }
  for (const side of DOCK_SIDES) {
    for (const group of collectGroups(layout.docks[side])) {
      if (group.id === exclude) continue;
      const el = groupElements.get(group.id);
      if (!el) continue;
      const rect = toLocal(el);
      groups.push({
        groupId: group.id,
        rect: {
          x: rect.left - hostRect.left,
          y: rect.top - hostRect.top,
          width: rect.width,
          height: rect.height,
        },
        isFloating: false,
        tabCount: group.tabs.length,
      });
    }
  }

  return {
    zones: {
      hostRect: { x: 0, y: 0, width: hostRect.width, height: hostRect.height },
      groups,
    },
    hostOrigin: { x: hostRect.left, y: hostRect.top },
  };
}

/** Host-local rect of a registered group element (for float-drop sizing). */
export function getGroupRect(groupId: string): { width: number; height: number } | null {
  const el = groupElements.get(groupId);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

/** Live registered element for a tab group, or null if not mounted. */
export function getGroupElement(groupId: string): HTMLElement | null {
  return groupElements.get(groupId) ?? null;
}
