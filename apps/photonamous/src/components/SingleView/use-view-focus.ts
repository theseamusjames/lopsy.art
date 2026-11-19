import { useEffect, useRef, type RefObject } from 'react';
import { useUi } from '../../app/store';

/**
 * Keyboard focus for a view that takes the grid's place (Single, Cull,
 * Compare): the view takes focus when it opens, and takes it back when
 * what had it inside the view goes away (a version deleted, a button that
 * disappears) or when a dialog or the Edit view opened from it closes and
 * focus has nowhere else to go.
 */
export function useViewFocus(view: RefObject<HTMLElement | null>): void {
  const within = useRef(false);
  const layer = useUi((s) => `${s.dialog !== null && s.dialog !== 'help' && s.dialog !== 'sync'}:${s.editing !== null}`);

  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      within.current = e.target instanceof Node && view.current?.contains(e.target) === true;
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || view.current?.contains(e.target) !== true) within.current = false;
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('pointerdown', onPointerDown, true);
    view.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [view]);

  const layerSeen = useRef(layer);
  useEffect(() => {
    const reopened = layerSeen.current !== layer && layer === 'false:false';
    layerSeen.current = layer;
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    if (lost && (within.current || reopened)) view.current?.focus({ preventScroll: true });
  });
}
