// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Engine } from './wasm-bridge';

const setScreenOutput = vi.fn<(engine: Engine, isDisplayP3: boolean, wantsHdr: boolean) => boolean>();
vi.mock('./wasm-bridge', () => ({ setScreenOutput: (...args: [Engine, boolean, boolean]) => setScreenOutput(...args) }));
vi.mock('../engine/color-space', () => ({ canvasColorSpace: 'display-p3' }));

const { isScreenHdr, onScreenHdrChange, stopWatchingScreenOutput, watchScreenOutput } = await import('./screen-output');

/** A stand-in for `matchMedia('(dynamic-range: high)')` whose answer can change. */
function stubDisplay(isHdr: boolean): { set: (next: boolean) => void; listenerCount: () => number } {
  const listeners = new Set<() => void>();
  const query = {
    matches: isHdr,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => query);
  return {
    set: (next) => {
      query.matches = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

const engine = {} as Engine;

describe('watchScreenOutput', () => {
  beforeEach(() => {
    setScreenOutput.mockReset();
    // The engine makes the canvas HDR whenever it is asked to.
    setScreenOutput.mockImplementation((_engine, _isDisplayP3, wantsHdr) => wantsHdr);
  });

  afterEach(() => {
    stopWatchingScreenOutput();
    vi.unstubAllGlobals();
  });

  it('asks for HDR on an HDR display, in the session colour space', () => {
    stubDisplay(true);
    watchScreenOutput(engine);
    expect(setScreenOutput).toHaveBeenCalledWith(engine, true, true);
    expect(isScreenHdr()).toBe(true);
  });

  it('follows the window to a display of another range and tells listeners', () => {
    const display = stubDisplay(false);
    const heard = vi.fn();
    const stop = onScreenHdrChange(heard);
    watchScreenOutput(engine);
    expect(isScreenHdr()).toBe(false);
    expect(heard).not.toHaveBeenCalled();

    display.set(true);
    expect(setScreenOutput).toHaveBeenLastCalledWith(engine, true, true);
    expect(isScreenHdr()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);

    display.set(false);
    expect(isScreenHdr()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });

  it('is not HDR where the engine cannot make the canvas so', () => {
    stubDisplay(true);
    setScreenOutput.mockReturnValue(false);
    watchScreenOutput(engine);
    expect(isScreenHdr()).toBe(false);
  });

  it('stops listening and reports SDR once the engine is gone', () => {
    const display = stubDisplay(true);
    watchScreenOutput(engine);
    expect(display.listenerCount()).toBe(1);
    stopWatchingScreenOutput();
    expect(display.listenerCount()).toBe(0);
    expect(isScreenHdr()).toBe(false);
    setScreenOutput.mockClear();
    display.set(false);
    expect(setScreenOutput).not.toHaveBeenCalled();
  });
});
