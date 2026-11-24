// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { HDR_RANGE_QUERY, P3_GAMUT_QUERY, SRGB_DISPLAY, readDisplay, watchDisplay, type MatchMedia } from './display';

/** A stand-in for `matchMedia` whose answers can change, as moving the window to another display does. */
function stubMatch(answers: Record<string, boolean>): { match: MatchMedia; set: (query: string, next: boolean) => void; listenerCount: () => number } {
  const listeners = new Map<string, Set<() => void>>();
  const match: MatchMedia = (query) => {
    const own = listeners.get(query) ?? new Set<() => void>();
    listeners.set(query, own);
    return {
      get matches() {
        return answers[query] ?? false;
      },
      addEventListener: (_type, listener) => own.add(listener),
      removeEventListener: (_type, listener) => own.delete(listener),
    };
  };
  return {
    match,
    set: (query, next) => {
      answers[query] = next;
      for (const listener of listeners.get(query) ?? []) listener();
    },
    listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

describe('readDisplay', () => {
  it('reads the gamut and the dynamic range', () => {
    const { match } = stubMatch({ [P3_GAMUT_QUERY]: true, [HDR_RANGE_QUERY]: false });
    expect(readDisplay(match)).toEqual({ isDisplayP3: true, isHdr: false });
  });

  it('is an sRGB display where the browser cannot say', () => {
    expect(readDisplay(null)).toEqual(SRGB_DISPLAY);
  });
});

describe('watchDisplay', () => {
  it('reports a change of either query, once per change', () => {
    const stub = stubMatch({ [P3_GAMUT_QUERY]: false, [HDR_RANGE_QUERY]: false });
    const listener = vi.fn();
    watchDisplay(listener, stub.match);
    expect(listener).not.toHaveBeenCalled();
    stub.set(P3_GAMUT_QUERY, true);
    expect(listener).toHaveBeenLastCalledWith({ isDisplayP3: true, isHdr: false });
    stub.set(HDR_RANGE_QUERY, true);
    expect(listener).toHaveBeenLastCalledWith({ isDisplayP3: true, isHdr: true });
    stub.set(HDR_RANGE_QUERY, true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops listening when unsubscribed', () => {
    const stub = stubMatch({});
    const listener = vi.fn();
    const stop = watchDisplay(listener, stub.match);
    expect(stub.listenerCount()).toBe(2);
    stop();
    expect(stub.listenerCount()).toBe(0);
    stub.set(P3_GAMUT_QUERY, true);
    expect(listener).not.toHaveBeenCalled();
  });
});
