/**
 * The Edit view as a page of its own (WCAG 2.4.2, 2.4.3): its title in the
 * browser while it is open, and where focus goes when it opens and closes.
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** The page title while a photo is open in the Edit view. */
export function editPageTitle(fileName: string): string {
  return `${fileName} – Edit – Photonamous`;
}

/** Sets the page's title while the component is shown, and puts back the one it replaced. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/**
 * Moves focus to `target` when the component mounts. When it unmounts and
 * focus has gone with its elements, focus goes back to what had it before
 * it opened, if that is still on the page; whatever the page focused in
 * the meantime is left alone.
 */
export function useFocusOnOpen(target: RefObject<HTMLElement | null>): void {
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));
  useEffect(() => {
    target.current?.focus();
    return () => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [opener, target]);
}

/**
 * When a tool closes (`isOpen` turns false) and focus went with it, puts
 * focus on `target`, normally the button that opened it.
 */
export function useFocusReturn(isOpen: boolean, target: RefObject<HTMLElement | null>): void {
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (wasOpen.current && !isOpen) {
      const active = document.activeElement;
      if (!active || active === document.body) target.current?.focus();
    }
    wasOpen.current = isOpen;
  }, [isOpen, target]);
}

/**
 * While `isOn` disables the view's controls (Before), the browser takes
 * focus off a disabled one and leaves it on the page. Chrome does so at
 * once, as React sets `disabled`, before this hook's effect runs, so the
 * control that lost focus in that same commit is remembered too. The
 * control focused as it began gets focus back when it ends, unless focus
 * has gone somewhere else since.
 */
export function useFocusKept(isOn: boolean): void {
  const kept = useRef<HTMLElement | null>(null);
  // The element that lost focus to nothing in the task now running; cleared once it ends.
  const justLost = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const handleFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget !== null || !(e.target instanceof HTMLElement)) return;
      justLost.current = e.target;
      queueMicrotask(() => {
        justLost.current = null;
      });
    };
    document.addEventListener('focusout', handleFocusOut, true);
    return () => document.removeEventListener('focusout', handleFocusOut, true);
  }, []);
  useLayoutEffect(() => {
    if (isOn) {
      const active = document.activeElement;
      kept.current = active instanceof HTMLElement && active !== document.body ? active : justLost.current;
      return;
    }
    const element = kept.current;
    kept.current = null;
    const active = document.activeElement;
    if (element?.isConnected && (!active || active === document.body)) element.focus();
  }, [isOn]);
}
