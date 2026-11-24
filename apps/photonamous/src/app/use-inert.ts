import { useEffect, useLayoutEffect, type RefObject } from 'react';
import type { DialogName } from './store';

/**
 * Whether a dialog is one that covers the app (aria-modal made true): all
 * but the shortcut list and the saving panel, which sit beside the work.
 */
export function dialogCovers(dialog: DialogName): boolean {
  return dialog !== null && dialog !== 'help' && dialog !== 'sync';
}

/**
 * Puts an element out of reach while something covers it. Inert comes a
 * frame after the layer on top has taken focus and noted where focus was,
 * to give it back there (a focused element turning inert would lose focus
 * first), and goes before that layer gives focus back.
 */
export function useInert(ref: RefObject<HTMLElement | null>, covered: boolean): void {
  useLayoutEffect(() => {
    if (!covered && ref.current) ref.current.inert = false;
  }, [ref, covered]);
  useEffect(() => {
    if (!covered) return;
    const frame = requestAnimationFrame(() => {
      if (ref.current) ref.current.inert = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [ref, covered]);
}
