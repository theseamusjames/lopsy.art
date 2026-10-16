import { useEffect, useRef } from 'react';

type Dismiss = () => void;

/** Open non-modal popovers, most recently opened last. */
const dismissers: Dismiss[] = [];

/**
 * Close the most recently opened popover. Returns false when none is open.
 *
 * The global shortcut handler calls this before acting on Escape, so the key
 * closes an options-bar popover instead of reaching the tool behind it — a
 * text edit in progress would otherwise be cancelled with its colour picker
 * still open (#1233).
 */
export function dismissTopPopover(): boolean {
  const top = dismissers.pop();
  if (!top) return false;
  top();
  return true;
}

export function registerEscapeDismiss(dismiss: Dismiss): () => void {
  dismissers.push(dismiss);
  return () => {
    const i = dismissers.lastIndexOf(dismiss);
    if (i >= 0) dismissers.splice(i, 1);
  };
}

/** While `isOpen`, Escape outside a text field calls `onDismiss`. */
export function useEscapeDismiss(isOpen: boolean, onDismiss: () => void): void {
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!isOpen) return;
    return registerEscapeDismiss(() => onDismissRef.current());
  }, [isOpen]);
}
