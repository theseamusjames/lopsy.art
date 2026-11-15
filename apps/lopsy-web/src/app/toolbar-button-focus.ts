import { useEffect } from 'react';

/**
 * Drop focus from a toolbar button after a pointer click (#817).
 *
 * A clicked button keeps focus, so the next Enter or Space re-activates
 * it — pressing Enter after Move → Flip Horizontal flipped the layer
 * back. Keyboard activation dispatches its click with `detail === 0`,
 * so buttons reached with Tab still keep focus and stay operable.
 * Blurring after the click (rather than preventing focus on mousedown)
 * keeps the normal blur of a focused text field, which is where
 * NumberInput commits typed values.
 */
export function releaseToolbarButtonFocus(e: MouseEvent): void {
  if (e.detail === 0) return;
  const target = e.target;
  if (!(target instanceof Element)) return;
  const button = target.closest('button, [role="button"]');
  if (!(button instanceof HTMLElement)) return;
  if (!button.closest('[role="toolbar"]')) return;
  if (document.activeElement === button) button.blur();
}

export function useReleaseToolbarButtonFocus(): void {
  useEffect(() => {
    document.addEventListener('click', releaseToolbarButtonFocus);
    return () => document.removeEventListener('click', releaseToolbarButtonFocus);
  }, []);
}
