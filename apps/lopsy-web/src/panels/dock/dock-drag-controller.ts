import type { Rect } from '../../types';
import type { DropTarget } from './dock-layout';
import { useDockStore } from './dock-store';
import { getPanelTitle } from './panel-registry';
import type { DropZones } from './drop-zones';
import { dropIndicatorRect, resolveDropTarget } from './drop-zones';
import { captureDropZones, getGroupRect, getHostElement } from './dock-element-registry';

/**
 * Pointer-driven drag controller for dock tabs and floating windows. Plain
 * DOM logic (no React): components call `beginTabDrag` / `beginWindowDrag`
 * from their pointerdown handlers; the controller owns window listeners for
 * the rest of the gesture and talks to the dock store.
 */

/** Movement (px) before a pointerdown becomes a drag. */
const DRAG_THRESHOLD = 5;
/** Default size of the window created when a tab is dropped in open space. */
const FLOAT_DEFAULT_WIDTH = 320;
const FLOAT_DEFAULT_HEIGHT = 400;

interface PointerDownLike {
  clientX: number;
  clientY: number;
  pointerId: number;
  button: number;
  currentTarget: EventTarget | null;
}

interface ActiveDrag {
  source:
    | { kind: 'tab'; panelId: string; groupId: string }
    | { kind: 'window'; windowId: string; originX: number; originY: number };
  pointerId: number;
  startClientX: number;
  startClientY: number;
  activated: boolean;
  zones: DropZones | null;
  hostOrigin: { x: number; y: number };
  /** Size hint for the float rect when dropping in open space. */
  sourceSize: { width: number; height: number };
  captureEl: HTMLElement | null;
}

let active: ActiveDrag | null = null;

function cleanup(): void {
  if (!active) return;
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', handlePointerUp);
  window.removeEventListener('pointercancel', handlePointerCancel);
  window.removeEventListener('keydown', handleKeyDown, true);
  if (active.captureEl?.hasPointerCapture(active.pointerId)) {
    active.captureEl.releasePointerCapture(active.pointerId);
  }
  active = null;
  useDockStore.getState().setDrag(null);
}

function hostLocal(clientX: number, clientY: number): { x: number; y: number } {
  const origin = active?.hostOrigin ?? { x: 0, y: 0 };
  return { x: clientX - origin.x, y: clientY - origin.y };
}

function activate(drag: ActiveDrag): void {
  const state = useDockStore.getState();
  const exclude = drag.source.kind === 'window' ? drag.source.windowId : undefined;
  const captured = captureDropZones(state.layout, exclude);
  if (!captured) {
    cleanup();
    return;
  }
  drag.zones = captured.zones;
  drag.hostOrigin = captured.hostOrigin;
  drag.activated = true;
}

function resolveTarget(drag: ActiveDrag, x: number, y: number): DropTarget | null {
  if (!drag.zones) return null;
  return resolveDropTarget(x, y, drag.zones);
}

function updateDragState(drag: ActiveDrag, clientX: number, clientY: number): DropTarget | null {
  const pointer = hostLocal(clientX, clientY);
  const target = resolveTarget(drag, pointer.x, pointer.y);
  const store = useDockStore.getState();
  const indicator = drag.zones ? dropIndicatorRect(target, drag.zones) : null;
  const title =
    drag.source.kind === 'tab'
      ? getPanelTitle(drag.source.panelId)
      : '';
  store.setDrag({
    source:
      drag.source.kind === 'tab'
        ? { kind: 'tab', panelId: drag.source.panelId, groupId: drag.source.groupId }
        : { kind: 'window', windowId: drag.source.windowId },
    pointer,
    target,
    indicator,
    title,
    showGhost: drag.source.kind === 'tab',
  });
  return target;
}

function handlePointerMove(e: PointerEvent): void {
  const drag = active;
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.activated) {
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    activate(drag);
    if (!active) return;
  }
  e.preventDefault();

  if (drag.source.kind === 'window') {
    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;
    useDockStore
      .getState()
      .moveWindow(drag.source.windowId, drag.source.originX + dx, Math.max(0, drag.source.originY + dy));
  }
  updateDragState(drag, e.clientX, e.clientY);
}

function handlePointerUp(e: PointerEvent): void {
  const drag = active;
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.activated) {
    cleanup();
    return;
  }
  const pointer = hostLocal(e.clientX, e.clientY);
  const target = resolveTarget(drag, pointer.x, pointer.y);
  const store = useDockStore.getState();

  if (drag.source.kind === 'tab') {
    const finalTarget: DropTarget = target ?? {
      kind: 'float',
      rect: floatRectAt(pointer, drag.sourceSize),
    };
    store.dropTab(drag.source.panelId, finalTarget);
  } else if (target) {
    store.dropWindow(drag.source.windowId, target);
  }

  const host = getHostElement();
  if (host) {
    const rect = host.getBoundingClientRect();
    store.clampToHost(rect.width, rect.height);
  }
  cleanup();
}

function floatRectAt(pointer: { x: number; y: number }, size: { width: number; height: number }): Rect {
  const width = Math.min(size.width, 420);
  const height = Math.min(size.height, 480);
  return {
    x: pointer.x - Math.min(60, width / 2),
    y: Math.max(0, pointer.y - 14),
    width,
    height,
  };
}

function handlePointerCancel(e: PointerEvent): void {
  const drag = active;
  if (!drag || e.pointerId !== drag.pointerId) return;
  cancelDrag();
}

function handleKeyDown(e: KeyboardEvent): void {
  // Only consume Escape once the gesture has actually crossed the drag
  // threshold — a bare pointerdown that never moved must not swallow Escape
  // from modals or tool-cancel handlers.
  if (e.key !== 'Escape' || !active?.activated) return;
  e.stopPropagation();
  cancelDrag();
}

function cancelDrag(): void {
  const drag = active;
  if (drag?.activated && drag.source.kind === 'window') {
    useDockStore.getState().moveWindow(drag.source.windowId, drag.source.originX, drag.source.originY);
  }
  cleanup();
}

function begin(e: PointerDownLike, source: ActiveDrag['source'], sourceGroupId: string): void {
  if (active || e.button !== 0) return;
  const size = getGroupRect(sourceGroupId) ?? {
    width: FLOAT_DEFAULT_WIDTH,
    height: FLOAT_DEFAULT_HEIGHT,
  };
  const captureEl = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
  active = {
    source,
    pointerId: e.pointerId,
    startClientX: e.clientX,
    startClientY: e.clientY,
    activated: false,
    zones: null,
    hostOrigin: { x: 0, y: 0 },
    sourceSize: size,
    captureEl,
  };
  try {
    captureEl?.setPointerCapture(e.pointerId);
  } catch {
    // Capture is best-effort; window listeners carry the gesture anyway.
  }
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerCancel);
  window.addEventListener('keydown', handleKeyDown, true);
}

/** Start dragging a single tab out of a (docked or floating) group. */
export function beginTabDrag(e: PointerDownLike, panelId: string, groupId: string): void {
  begin(e, { kind: 'tab', panelId, groupId }, groupId);
}

/** Start dragging a whole floating window by its header. */
export function beginWindowDrag(e: PointerDownLike, windowId: string): void {
  const window_ = useDockStore.getState().layout.floating.find((w) => w.id === windowId);
  if (!window_) return;
  begin(
    e,
    { kind: 'window', windowId, originX: window_.x, originY: window_.y },
    windowId,
  );
}
