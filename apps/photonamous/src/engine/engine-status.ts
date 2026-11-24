/**
 * What the status bar says about the engine and the screen, kept outside
 * React so the engine code can set it: the build this page runs (set by
 * the generated selector when the wasm starts, renderer-choice.ts), whether
 * the engines run on the 8-bit fallback of a GPU with no float render
 * targets, and the display the window is on (`@lopsy/engine-wasm/display`,
 * watched for changes).
 */

import { readDisplay, watchDisplay, type DisplayInfo } from '@lopsy/engine-wasm/display';
import { onRunningRendererChange, runningRenderer, type Renderer } from './renderer-choice';

export interface EngineStatus {
  /** The build that runs; null until the engine's wasm has started in this page. */
  readonly renderer: Renderer | null;
  /** The last engine made has no float render targets, so photos are developed with the baked look in 8 bits. */
  readonly isEightBit: boolean;
  readonly display: DisplayInfo;
  /**
   * The Edit view's canvas really is HDR (`screenIsHdr`): the wgpu build,
   * a display that reports high dynamic range, and a browser that made the
   * float canvas. False everywhere else.
   */
  readonly isScreenHdr: boolean;
  /**
   * Whether the Edit view shows the HDR rendering (true) or how an ordinary
   * screen will show the photo (false). Kept for the page's life, not
   * stored; it matters only while `isScreenHdr`.
   */
  readonly isHdrView: boolean;
}

const listeners = new Set<() => void>();
let status: EngineStatus | null = null;
let stopDisplay: (() => void) | null = null;
let stopRenderer: (() => void) | null = null;

function update(patch: Partial<EngineStatus>): void {
  const now = currentStatus();
  const next = { ...now, ...patch };
  if (
    next.renderer === now.renderer &&
    next.isEightBit === now.isEightBit &&
    next.display === now.display &&
    next.isScreenHdr === now.isScreenHdr &&
    next.isHdrView === now.isHdrView
  ) {
    return;
  }
  status = next;
  for (const listener of [...listeners]) listener();
}

function start(): EngineStatus {
  const initial: EngineStatus = { renderer: runningRenderer(), isEightBit: false, display: readDisplay(), isScreenHdr: false, isHdrView: true };
  stopDisplay = watchDisplay((display) => update({ display }));
  stopRenderer = onRunningRendererChange(() => update({ renderer: runningRenderer() }));
  return initial;
}

/** The status now. The same object until something changes (for useSyncExternalStore). */
export function currentStatus(): EngineStatus {
  status ??= start();
  return status;
}

export function onStatusChange(listener: () => void): () => void {
  currentStatus();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** An engine started: whether it has float render targets (develop-engine.ts). */
export function noteEngineStarted(hasFloatTargets: boolean): void {
  update({ renderer: runningRenderer(), isEightBit: !hasFloatTargets });
}

/** The Edit view's engine says whether its canvas is HDR now (false when it goes away). */
export function noteScreenHdr(isScreenHdr: boolean): void {
  update({ isScreenHdr });
}

/** The status bar's switch: the HDR rendering on screen, or the ordinary screen's. */
export function setHdrView(isHdrView: boolean): void {
  update({ isHdrView });
}

/** Whether the Edit view shows highlights above white now. */
export function showsHdr(s: EngineStatus): boolean {
  return s.isScreenHdr && s.isHdrView;
}

/** Tests: forget the status and stop watching, so the next read starts again. */
export function resetEngineStatus(): void {
  stopDisplay?.();
  stopRenderer?.();
  stopDisplay = null;
  stopRenderer = null;
  status = null;
  listeners.clear();
}

const RENDERER_LABELS: Record<Renderer, string> = { webgl: 'WebGL', wgpu: 'WebGPU' };

/** "WebGPU", "WebGL", or "WebGL 8-bit" on the no-float fallback; null while unknown. */
export function rendererLabel(s: EngineStatus): string | null {
  if (!s.renderer) return null;
  const name = RENDERER_LABELS[s.renderer];
  return s.isEightBit ? `${name} 8-bit` : name;
}

/** The display's gamut, as the canvas is set up for it. */
export function displayLabel(s: EngineStatus): string {
  return s.display.isDisplayP3 ? 'Display P3' : 'sRGB';
}

/** "HDR" while the canvas really is HDR; null otherwise, and the status bar then says nothing about it. */
export function hdrLabel(s: EngineStatus): string | null {
  return s.isScreenHdr ? 'HDR' : null;
}

/** The HDR switch's accessible name: what pressing it does. Its pressed state says which view is on. */
export const HDR_VIEW_SWITCH_LABEL = 'Show highlights in HDR (off: as an ordinary screen shows the photo)';
