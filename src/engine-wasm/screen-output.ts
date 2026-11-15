/**
 * What the canvas is told about the pixels the engine draws to it, on the
 * wgpu engine: Display P3 or sRGB, and whether it is HDR.
 *
 * An HDR canvas keeps document values above 1.0 and the display shows them
 * brighter than white (EDR on a Mac). It is used while the display the
 * window is on reports high dynamic range, and follows the window from one
 * display to another. The WebGL canvas is 8 bits a channel and is never
 * HDR; the page sets its colour space itself.
 */

import type { Engine } from './wasm-bridge';
import { setScreenOutput } from './wasm-bridge';
import { canvasColorSpace } from '../engine/color-space';

const HDR_DISPLAY_QUERY = '(dynamic-range: high)';

let isHdr = false;
let stopWatching: (() => void) | null = null;
const listeners = new Set<() => void>();

/** Whether the canvas is showing values above 1.0 brighter than white. */
export function isScreenHdr(): boolean {
  return isHdr;
}

/** Call `listener` whenever `isScreenHdr` changes. Returns the unsubscribe. */
export function onScreenHdrChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setHdr(next: boolean): void {
  if (next === isHdr) return;
  isHdr = next;
  for (const listener of listeners) listener();
}

/**
 * Configure the wgpu engine's canvas for the display the window is on, and
 * again whenever that display's dynamic range changes.
 */
export function watchScreenOutput(engine: Engine): void {
  stopWatchingScreenOutput();
  const display = typeof matchMedia === 'function' ? matchMedia(HDR_DISPLAY_QUERY) : null;
  const apply = (): void => {
    setHdr(setScreenOutput(engine, canvasColorSpace === 'display-p3', display?.matches ?? false));
  };
  apply();
  display?.addEventListener('change', apply);
  stopWatching = () => display?.removeEventListener('change', apply);
}

/** Stop following the display: the engine is going away. */
export function stopWatchingScreenOutput(): void {
  stopWatching?.();
  stopWatching = null;
  setHdr(false);
}
