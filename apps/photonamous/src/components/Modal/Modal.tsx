import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../IconButton/IconButton';
import { focusedElement, nextTabStop, returnFocus, tabStops } from '@lopsy/ui/a11y/focus-trap';
import { closeLayer, isTopLayer, isTopModal, openLayer, type Layer } from '@lopsy/ui/a11y/layers';
import styles from './Modal.module.css';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Buttons along the bottom. */
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
}

/** The first thing to focus: a `data-autofocus` element, else the first control in the body or footer, else the dialog. */
function initialFocus(root: HTMLElement): HTMLElement {
  const marked = root.querySelector<HTMLElement>('[data-autofocus]');
  if (marked) return marked;
  for (const part of root.querySelectorAll<HTMLElement>(`.${styles.body}, .${styles.footer}`)) {
    const first = tabStops(part)[0];
    if (first) return first;
  }
  return root;
}

/**
 * A modal dialog. Focus moves in when it opens, stays inside while it is
 * open (Tab and Shift+Tab wrap), and goes back where it was when it closes.
 * Escape closes it wherever focus is, unless a dialog or popover opened from
 * it is on top. Keys pressed in it never reach the page's shortcuts.
 */
export function Modal({ title, onClose, children, footer, width = 'md' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);
  const layer = useRef<Layer | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  const handleKey = (e: KeyboardEvent) => {
    const root = ref.current;
    const own = layer.current;
    if (!root || !own || e.defaultPrevented) return;
    if (e.key === 'Escape' && isTopLayer(own)) {
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
    } else if (e.key === 'Tab' && isTopModal(own)) {
      e.preventDefault();
      (nextTabStop(root, document.activeElement, e.shiftKey) ?? root).focus();
    }
  };
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const own = openLayer(true);
    layer.current = own;
    previous.current = focusedElement();
    initialFocus(root).focus();

    // Keys from outside the dialog (focus on the page, or nowhere) still close it and bring Tab back in.
    const onKey = (e: KeyboardEvent) => handleKeyRef.current(e);
    // Focus that lands behind the dialog (from the browser's toolbar, or a script) comes back in.
    const onFocusIn = (e: FocusEvent) => {
      if (!isTopModal(own) || !(e.target instanceof Node) || root.contains(e.target)) return;
      (tabStops(root)[0] ?? root).focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      closeLayer(own);
      layer.current = null;
    };
  }, []);

  // Focus goes back after the commit's layout effects, where the page behind drops `inert`: an inert
  // element can't take focus. Done before other passive effects, so nothing else picks a new home for it.
  useEffect(() => {
    const root = ref.current;
    return () => returnFocus(previous.current, root);
  }, []);

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`${styles.dialog} ${styles[width]}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation();
          handleKey(e.nativeEvent);
        }}
      >
        <div className={styles.header}>
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          <IconButton label="Close" icon={<X size={16} />} size="sm" onClick={onClose} />
        </div>
        <div className={styles.body}>{children}</div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>
  );
}
