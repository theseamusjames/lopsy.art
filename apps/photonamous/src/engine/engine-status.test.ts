import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let running: 'wgpu' | 'webgl' | null = null;
const rendererListeners = new Set<() => void>();
vi.mock('./renderer-choice', () => ({
  runningRenderer: () => running,
  onRunningRendererChange: (listener: () => void) => {
    rendererListeners.add(listener);
    return () => rendererListeners.delete(listener);
  },
}));

let p3 = false;
const displayListeners = new Set<() => void>();
const query = (q: string) => ({
  get matches() {
    return q.includes('color-gamut') ? p3 : false;
  },
  addEventListener: (_type: string, listener: () => void) => displayListeners.add(listener),
  removeEventListener: (_type: string, listener: () => void) => displayListeners.delete(listener),
});

const { currentStatus, displayLabel, hdrLabel, noteEngineStarted, noteScreenHdr, onStatusChange, rendererLabel, resetEngineStatus, setHdrView, showsHdr } =
  await import('./engine-status');

describe('engine status', () => {
  beforeEach(() => {
    running = null;
    p3 = false;
    vi.stubGlobal('matchMedia', query);
  });

  afterEach(() => {
    resetEngineStatus();
    vi.unstubAllGlobals();
    rendererListeners.clear();
    displayListeners.clear();
  });

  it('knows no renderer until the wasm has started, then the one the selector noted', () => {
    expect(rendererLabel(currentStatus())).toBeNull();
    const listener = vi.fn();
    onStatusChange(listener);
    running = 'wgpu';
    for (const l of rendererListeners) l();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(rendererLabel(currentStatus())).toBe('WebGPU');
  });

  it('says 8-bit when an engine has no float render targets', () => {
    running = 'webgl';
    noteEngineStarted(false);
    expect(rendererLabel(currentStatus())).toBe('WebGL 8-bit');
    noteEngineStarted(true);
    expect(rendererLabel(currentStatus())).toBe('WebGL');
  });

  it('follows the display from sRGB to Display P3', () => {
    expect(displayLabel(currentStatus())).toBe('sRGB');
    const before = currentStatus();
    p3 = true;
    for (const l of displayListeners) l();
    expect(currentStatus()).not.toBe(before);
    expect(displayLabel(currentStatus())).toBe('Display P3');
  });

  it('keeps the same object while nothing changes', () => {
    running = 'wgpu';
    const a = currentStatus();
    noteEngineStarted(true);
    expect(currentStatus()).toBe(a);
  });

  it('says HDR only while the canvas really is HDR, and the switch decides what shows', () => {
    expect(hdrLabel(currentStatus())).toBeNull();
    expect(currentStatus().isHdrView).toBe(true);
    expect(showsHdr(currentStatus())).toBe(false);
    noteScreenHdr(true);
    expect(hdrLabel(currentStatus())).toBe('HDR');
    expect(showsHdr(currentStatus())).toBe(true);
    const listener = vi.fn();
    onStatusChange(listener);
    setHdrView(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(showsHdr(currentStatus())).toBe(false);
    expect(hdrLabel(currentStatus())).toBe('HDR');
    noteScreenHdr(false);
    expect(hdrLabel(currentStatus())).toBeNull();
    // The switch is remembered for the page while the canvas comes and goes.
    expect(currentStatus().isHdrView).toBe(false);
  });
});
