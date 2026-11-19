import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { focusedElement, returnFocus, tabStops } from '@lopsy/ui/a11y/focus-trap';
import { closeLayer, isTopLayer, openLayer, type Layer } from '@lopsy/ui/a11y/layers';
import styles from './Popover.module.css';

interface PopoverProps {
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
  label: string;
}

/** Keys a control or a scrolling list inside the popover uses, which the page's shortcuts must not also act on. */
const OWN_KEYS = new Set(['Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

/**
 * A panel under its trigger. Place it inside a `position: relative` wrapper
 * that also holds the trigger. Focus moves into it when it opens and back to
 * where it was when it closes, unless the user clicked somewhere else. It
 * closes on Escape, on a click outside, and when focus moves out of it.
 */
export function Popover({ onClose, children, align = 'end', label }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const layer = useRef<Layer | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const own = openLayer(false);
    layer.current = own;
    const previous = focusedElement();
    let isClickedAway = false;
    (tabStops(root)[0] ?? root).focus();

    const isOutside = (target: EventTarget | null) => {
      const wrapper = root.parentElement;
      return wrapper !== null && target instanceof Node && !wrapper.contains(target);
    };
    const onDown = (e: MouseEvent) => {
      if (!isOutside(e.target)) return;
      isClickedAway = true;
      onCloseRef.current();
    };
    // Focus moving on (Tab past the end) closes it, so it never covers what has focus.
    const onFocusIn = (e: FocusEvent) => {
      if (isOutside(e.target)) onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !isTopLayer(own)) return;
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKey);
      closeLayer(own);
      layer.current = null;
      if (!isClickedAway) returnFocus(previous, root);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`${styles.popover} ${styles[align]}`}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={(e) => {
        const own = layer.current;
        if (e.key === 'Escape') {
          if (e.defaultPrevented || !own || !isTopLayer(own)) return;
          e.preventDefault();
          e.stopPropagation();
          onCloseRef.current();
          return;
        }
        if (OWN_KEYS.has(e.key)) e.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}
