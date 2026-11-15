/**
 * Physical screen pixels per CSS pixel. The canvas and overlay backing stores
 * are sized by this so Retina displays draw them at native resolution; sized
 * in CSS pixels, the browser would upscale (and blur) them by this factor.
 */
export function getDisplayPixelRatio(): number {
  return window.devicePixelRatio || 1;
}

/**
 * Size a canvas backing store to cover `cssWidth`×`cssHeight` at native
 * resolution. Returns true when the size changed, which also clears it.
 */
export function sizeCanvasToDisplay(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): boolean {
  const ratio = getDisplayPixelRatio();
  const width = Math.round(cssWidth * ratio);
  const height = Math.round(cssHeight * ratio);
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}

/** Backing-store pixels per CSS pixel actually in effect for a sized canvas. */
export function canvasPixelRatio(canvas: HTMLCanvasElement, cssWidth: number): number {
  return cssWidth > 0 ? canvas.width / cssWidth : 1;
}
