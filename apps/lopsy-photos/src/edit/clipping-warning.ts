/**
 * Clipping warnings (spec 5.4): the histogram's shadow and highlight
 * indicators toggle an overlay on the live frame (the engine paints
 * clipped pixels red at white, blue at black; exports never show it).
 * J toggles both, as in Lightroom. The warnings switch off when the Edit
 * view closes.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import type { DevelopEngine } from '../engine/develop-engine';

export interface ClippingWarning {
  readonly shadows: boolean;
  readonly highlights: boolean;
}

interface ClippingWarningState extends ClippingWarning {
  /** Shown only while Alt is held during a drag of Blacks (shadows) or Whites (highlights). */
  readonly during: ClippingWarning;
  setDuring(during: ClippingWarning): void;
  toggle(which: 'shadows' | 'highlights'): void;
  /** J: both on, unless both are on already. */
  toggleBoth(): void;
  reset(): void;
}

export const useClippingWarning = create<ClippingWarningState>()((set, get) => ({
  shadows: false,
  highlights: false,
  during: { shadows: false, highlights: false },
  setDuring: (during) => {
    const now = get().during;
    if (now.shadows !== during.shadows || now.highlights !== during.highlights) set({ during });
  },
  toggle: (which) => set((s) => (which === 'shadows' ? { shadows: !s.shadows } : { highlights: !s.highlights })),
  toggleBoth: () => {
    const on = !(get().shadows && get().highlights);
    set({ shadows: on, highlights: on });
  },
  reset: () => set({ shadows: false, highlights: false, during: { shadows: false, highlights: false } }),
}));

/** Whether a key press is J for the clipping warning, and not typing. */
export function isClippingKey(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; target: EventTarget | null }): boolean {
  if (event.key !== 'j' && event.key !== 'J') return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const target = event.target;
  if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return false;
  return true;
}

/** Keeps the engine's overlay in step with the toggles while the Edit view is open, and turns it off when it closes. */
export function useClippingWarningOnEngine(engine: DevelopEngine | null): void {
  const shadows = useClippingWarning((s) => s.shadows || s.during.shadows);
  const highlights = useClippingWarning((s) => s.highlights || s.during.highlights);

  useEffect(() => {
    engine?.setClippingWarning(shadows, highlights);
  }, [engine, shadows, highlights]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isClippingKey(event)) return;
      event.preventDefault();
      useClippingWarning.getState().toggleBoth();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Closing the Edit view turns the warnings off; the next open starts clean.
  useEffect(() => () => useClippingWarning.getState().reset(), []);
}
