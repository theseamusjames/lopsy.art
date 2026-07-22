import { useCallback, useRef } from 'react';
import styles from './DockSplitter.module.css';

interface DockSplitterProps {
  /** `vertical` dividers sit between row children and drag left–right. */
  orientation: 'vertical' | 'horizontal';
  onDragStart: () => void;
  /** Delta in px along the drag axis since drag start. */
  onDrag: (deltaPx: number) => void;
  label: string;
}

export function DockSplitter({ orientation, onDragStart, onDrag, label }: DockSplitterProps) {
  const dragRef = useRef<{ pointerId: number; start: number } | null>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || dragRef.current) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        start: orientation === 'vertical' ? e.clientX : e.clientY,
      };
      onDragStart();
    },
    [orientation, onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const position = orientation === 'vertical' ? e.clientX : e.clientY;
      onDrag(position - drag.start);
    },
    [orientation, onDrag],
  );

  const handlePointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
  }, []);

  // If capture is lost (element unmounts mid-drag, browser steals it) the
  // pointerup on this element never arrives — clear the ref so a stale drag
  // can't resume on the next pointerdown.
  const handleLostCapture = useCallback(() => {
    dragRef.current = null;
  }, []);

  return (
    <div
      className={orientation === 'vertical' ? styles.vertical : styles.horizontal}
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handleLostCapture}
    />
  );
}
