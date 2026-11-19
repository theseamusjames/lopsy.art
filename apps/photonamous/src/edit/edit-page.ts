/**
 * The Edit view as a page of its own (WCAG 2.4.2, 2.4.3): its title in the
 * browser while it is open, and where focus goes when it opens and closes.
 */

import { useEffect, useState, type RefObject } from 'react';

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
