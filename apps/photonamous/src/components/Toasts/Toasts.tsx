import { useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { pauseToasts, resumeToasts, useToasts, type Toast } from '../../app/toasts';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import { focusedElement } from '@lopsy/ui/a11y/focus-trap';
import styles from './Toasts.module.css';

/** Keys a toast's buttons use, which the page's shortcuts must not also act on. */
const OWN_KEYS = new Set(['Enter', ' ', 'Escape']);

/**
 * The toasts, in two live regions that are always on the page, so screen
 * readers hear each one as it arrives: errors as alerts, the rest
 * politely. They stay while the pointer is over them or focus is in one;
 * Escape dismisses the focused one, and its action (Undo) dismisses it
 * too. Focus in a toast that goes moves to another toast, or back where it
 * came from.
 */
export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const stackRef = useRef<HTMLDivElement>(null);
  const isHovered = useRef(false);
  const isFocused = useRef(false);
  const cameFrom = useRef<HTMLElement | null>(null);

  const hold = () => {
    if (isHovered.current || isFocused.current) pauseToasts();
    else resumeToasts();
  };

  // A toast that went while focused or under the pointer (replaced, or dismissed elsewhere) holds the rest no longer.
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (isFocused.current && !stack?.contains(document.activeElement)) {
      isFocused.current = false;
      if (focusedElement() === null && cameFrom.current?.isConnected) cameFrom.current.focus();
    }
    if (toasts.length === 0) isHovered.current = false;
    hold();
  }, [toasts]);

  const close = (id: number) => {
    const stack = stackRef.current;
    if (stack?.contains(document.activeElement)) {
      const other = [...stack.querySelectorAll<HTMLElement>('[data-toast-id]')].find((el) => el.dataset.toastId !== String(id));
      const target = other?.querySelector<HTMLElement>('button') ?? (cameFrom.current?.isConnected ? cameFrom.current : null);
      target?.focus();
    }
    dismiss(id);
  };

  const render = (t: Toast) => (
    <div key={t.id} className={styles.toast} data-toast-id={t.id}>
      <span>{t.message}</span>
      {t.action && (
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            close(t.id);
            t.action?.run();
          }}
        >
          {t.action.label}
        </Button>
      )}
      <IconButton size="sm" label="Dismiss" icon={<X size={12} />} onClick={() => close(t.id)} />
    </div>
  );

  return (
    <div
      ref={stackRef}
      className={styles.stack}
      onMouseEnter={() => {
        isHovered.current = true;
        hold();
      }}
      onMouseLeave={() => {
        isHovered.current = false;
        hold();
      }}
      onFocus={(e) => {
        if (!isFocused.current && !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) {
          cameFrom.current = e.relatedTarget instanceof HTMLElement ? e.relatedTarget : null;
        }
        isFocused.current = true;
        hold();
      }}
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        isFocused.current = false;
        hold();
      }}
      onKeyDown={(e) => {
        if (!OWN_KEYS.has(e.key)) return;
        e.stopPropagation();
        if (e.key !== 'Escape' || !(e.target instanceof Element)) return;
        const id = e.target.closest<HTMLElement>('[data-toast-id]')?.dataset.toastId;
        if (id === undefined) return;
        e.preventDefault();
        close(Number(id));
      }}
    >
      <div className={styles.region} role="alert" aria-live="assertive" aria-atomic="false">
        {toasts.filter((t) => t.isError).map(render)}
      </div>
      <div className={styles.region} role="status" aria-live="polite" aria-atomic="false">
        {toasts.filter((t) => !t.isError).map(render)}
      </div>
    </div>
  );
}
