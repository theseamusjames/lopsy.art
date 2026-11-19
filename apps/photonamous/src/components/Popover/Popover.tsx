import { useEffect, useRef, type ReactNode } from 'react';
import styles from './Popover.module.css';

interface PopoverProps {
  onClose: () => void;
  children: ReactNode;
  align?: 'start' | 'end';
  label: string;
}

/** A panel under its trigger. Closes on a click outside or Escape. Place it inside a `position: relative` wrapper. */
export function Popover({ onClose, children, align = 'end', label }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      const wrapper = el?.parentElement;
      if (wrapper && e.target instanceof Node && !wrapper.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={`${styles.popover} ${styles[align]}`} role="dialog" aria-label={label}>
      {children}
    </div>
  );
}
