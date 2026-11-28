import { afterEach, describe, expect, it, vi } from 'vitest';
import { zarazTracker } from './zaraz';

type Zaraz = NonNullable<Window['zaraz']>;

interface NodeEvents {
  on(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
}

function withZaraz(zaraz: Zaraz | undefined): void {
  vi.stubGlobal('window', zaraz ? { zaraz } : {});
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('zarazTracker', () => {
  it('hands the event and its properties to window.zaraz.track and says so', () => {
    const track = vi.fn(() => Promise.resolve());
    withZaraz({ track });
    expect(zarazTracker().track('guestbook', { name: 'Ada', count: 2, isNew: true })).toBe(true);
    expect(track.mock.calls).toEqual([['guestbook', { name: 'Ada', count: 2, isNew: true }]]);
  });

  it('answers false where the page has no Zaraz, or no window at all', () => {
    withZaraz(undefined);
    expect(zarazTracker().track('guestbook', {})).toBe(false);
    vi.unstubAllGlobals();
    expect(typeof window).toBe('undefined');
    expect(zarazTracker().track('guestbook', {})).toBe(false);
  });

  it('looks Zaraz up at each call, so one that arrives after the tracker was made is used', () => {
    withZaraz(undefined);
    const tracker = zarazTracker();
    expect(tracker.track('first', {})).toBe(false);
    const track = vi.fn();
    (window as Window).zaraz = { track };
    expect(tracker.track('second', { a: 1 })).toBe(true);
    expect(track.mock.calls).toEqual([['second', { a: 1 }]]);
  });

  it('answers false, and does not throw, when zaraz.track throws', () => {
    withZaraz({
      track: () => {
        throw new Error('broken');
      },
    });
    expect(zarazTracker().track('guestbook', {})).toBe(false);
  });

  it('keeps a rejected promise from zaraz.track from the caller', async () => {
    const unhandled = vi.fn();
    const node = (globalThis as unknown as { process: NodeEvents }).process;
    node.on('unhandledRejection', unhandled);
    try {
      withZaraz({ track: () => Promise.reject(new Error('offline')) });
      expect(zarazTracker().track('guestbook', {})).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      node.off('unhandledRejection', unhandled);
    }
  });

  it('answers false for a zaraz whose track is not a function', () => {
    withZaraz({ track: 'nope' } as unknown as Zaraz);
    expect(zarazTracker().track('guestbook', {})).toBe(false);
  });
});
