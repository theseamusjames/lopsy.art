/**
 * Cloudflare Zaraz as a `Tracker`. Zaraz is added to the page at the edge
 * in production and runs the Google Analytics tag there, so the page has
 * `window.zaraz.track` and no gtag of its own.
 */

import type { Tracker } from './tracker';

declare global {
  interface Window {
    /**
     * Cloudflare Zaraz. Absent in development, in tests and where a blocker
     * removes it; it can also arrive after the page's own script starts.
     */
    zaraz?: { track(eventName: string, properties?: Record<string, unknown>): unknown };
  }
}

/**
 * The Zaraz tracker. It looks `window.zaraz` up at each call, so a Zaraz
 * that arrives late is used once it is there; false when there is none or
 * the call throws. `zaraz.track` is async: an event that fails on its way
 * is lost quietly.
 */
export function zarazTracker(): Tracker {
  return {
    track(event, properties) {
      const zaraz = typeof window === 'undefined' ? undefined : window.zaraz;
      if (!zaraz || typeof zaraz.track !== 'function') return false;
      try {
        void Promise.resolve(zaraz.track(event, { ...properties })).catch(() => undefined);
        return true;
      } catch {
        return false;
      }
    },
  };
}
