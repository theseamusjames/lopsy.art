/**
 * The dialogs and popovers that are open, oldest first. Only the topmost
 * answers Escape, and only the topmost modal keeps Tab inside it, so a
 * dialog opened from a popover (or over another dialog) closes on its own.
 */

export interface Layer {
  readonly isModal: boolean;
}

const open: Layer[] = [];

export function openLayer(isModal: boolean): Layer {
  const layer: Layer = { isModal };
  open.push(layer);
  return layer;
}

export function closeLayer(layer: Layer): void {
  const at = open.indexOf(layer);
  if (at >= 0) open.splice(at, 1);
}

export function isTopLayer(layer: Layer): boolean {
  return open[open.length - 1] === layer;
}

export function isTopModal(layer: Layer): boolean {
  for (let i = open.length - 1; i >= 0; i--) {
    if (open[i]?.isModal) return open[i] === layer;
  }
  return false;
}
