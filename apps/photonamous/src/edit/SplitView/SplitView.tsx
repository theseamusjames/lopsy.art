import { useRef, type CSSProperties, type PointerEvent } from 'react';
import { splitAfterKey, splitValueText } from '../edit-keys';
import styles from './SplitView.module.css';

export interface SplitViewProps {
  /** Where the image is on the stage, in CSS pixels. */
  readonly imageBox: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  /** The photo without its develop settings, rendered at the image box's size; null while it renders. */
  readonly beforeSrc: string | null;
  /** Where the divider is across the image, 0..1. Left of it shows before. */
  readonly at: number;
  readonly onChange: (at: number) => void;
}

/**
 * Before and after side by side: the before render over the left of the
 * image, split by a divider that drags, or moves with the arrow keys.
 */
export function SplitView({ imageBox, beforeSrc, at, onChange }: SplitViewProps) {
  const drag = useRef<number | null>(null);

  const moveTo = (clientX: number, target: HTMLElement) => {
    const stage = target.parentElement?.getBoundingClientRect();
    if (!stage || imageBox.width <= 0) return;
    onChange(Math.min(1, Math.max(0, (clientX - stage.left - imageBox.left) / imageBox.width)));
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = e.pointerId;
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== e.pointerId) return;
    moveTo(e.clientX, e.currentTarget);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current === e.pointerId) drag.current = null;
  };

  const vars = {
    '--split-left': `${imageBox.left}px`,
    '--split-top': `${imageBox.top}px`,
    '--split-width': `${imageBox.width}px`,
    '--split-height': `${imageBox.height}px`,
    '--split-at': `${at * 100}%`,
    '--split-x': `${imageBox.left + at * imageBox.width}px`,
  } as CSSProperties;

  return (
    <>
      {beforeSrc && <img className={styles.before} style={vars} src={beforeSrc} alt="" data-testid="split-before" draggable={false} />}
      <span className={styles.labelBefore} style={vars}>
        Before
      </span>
      <span className={styles.labelAfter} style={vars}>
        After
      </span>
      <div
        className={styles.divider}
        style={vars}
        role="slider"
        tabIndex={0}
        aria-label="Before and after divider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(at * 100)}
        aria-valuetext={splitValueText(at)}
        data-testid="split-divider"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={(e) => {
          const next = splitAfterKey(at, e.key, e.shiftKey);
          if (next === null) return;
          e.preventDefault();
          onChange(next);
        }}
      />
    </>
  );
}
