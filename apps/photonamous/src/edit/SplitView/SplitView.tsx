import { useId, useRef, type CSSProperties, type PointerEvent } from 'react';
import { SPLIT_SWAP_KEY, splitAfterKey, splitSidesText, splitValueText } from '../edit-keys';
import styles from './SplitView.module.css';

/**
 * How far, in CSS pixels, the pointer moves sideways from where it was
 * pressed before the press is a drag: the two clicks of a double-click,
 * and a small jitter between them, leave the divider where it is.
 */
export const SPLIT_DRAG_SLOP = 4;

const SWAP_HINT = `Double-click or press ${SPLIT_SWAP_KEY} to swap`;

export interface SplitViewProps {
  /** Where the image is on the stage, in CSS pixels. */
  readonly imageBox: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
  /** The photo without its develop settings, rendered at the image box's size; null while it renders. */
  readonly beforeSrc: string | null;
  /** Where the divider is across the image, 0..1 from the left. */
  readonly at: number;
  readonly onChange: (at: number) => void;
  /** Before shows right of the divider and the edit left of it. */
  readonly isSwapped: boolean;
  /** Double-clicking the divider, or Enter on it, asks for the sides to swap. */
  readonly onSwap: () => void;
}

/**
 * Before and after side by side: the before render over the left of the
 * image (the right, swapped), split by a divider that drags, or moves with
 * the arrow keys. Double-clicking the divider, or Enter, swaps the sides.
 */
export function SplitView({ imageBox, beforeSrc, at, onChange, isSwapped, onSwap }: SplitViewProps) {
  const press = useRef<{ readonly id: number; readonly x: number; isDragging: boolean } | null>(null);
  const descriptionId = useId();

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
    press.current = { id: e.pointerId, x: e.clientX, isDragging: false };
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    if (!p.isDragging) {
      if (Math.abs(e.clientX - p.x) <= SPLIT_DRAG_SLOP) return;
      p.isDragging = true;
    }
    moveTo(e.clientX, e.currentTarget);
  };

  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (press.current?.id === e.pointerId) press.current = null;
  };

  const vars = {
    '--split-left': `${imageBox.left}px`,
    '--split-top': `${imageBox.top}px`,
    '--split-width': `${imageBox.width}px`,
    '--split-height': `${imageBox.height}px`,
    '--split-at': `${at * 100}%`,
    '--split-x': `${imageBox.left + at * imageBox.width}px`,
  } as CSSProperties;
  const beforeSide = isSwapped ? 'right' : 'left';

  return (
    <>
      {beforeSrc && (
        <img className={styles.before} style={vars} src={beforeSrc} alt="" data-testid="split-before" data-side={beforeSide} draggable={false} />
      )}
      <span className={styles.labelLeft} style={vars} data-testid="split-label-left">
        {isSwapped ? 'After' : 'Before'}
      </span>
      <span className={styles.labelRight} style={vars} data-testid="split-label-right">
        {isSwapped ? 'Before' : 'After'}
      </span>
      <span id={descriptionId} className={styles.srOnly}>
        {splitSidesText(isSwapped)}. {SWAP_HINT}.
      </span>
      <div
        className={styles.divider}
        style={vars}
        role="slider"
        tabIndex={0}
        aria-label="Before and after divider"
        aria-describedby={descriptionId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(at * 100)}
        aria-valuetext={splitValueText(at, isSwapped)}
        title={`${SWAP_HINT} before and after`}
        data-testid="split-divider"
        data-before-side={beforeSide}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => onSwap()}
        onKeyDown={(e) => {
          if (e.key === SPLIT_SWAP_KEY && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            // Held down, Enter swaps once.
            if (!e.repeat) onSwap();
            return;
          }
          const next = splitAfterKey(at, e.key, e.shiftKey);
          if (next === null) return;
          e.preventDefault();
          onChange(next);
        }}
      />
    </>
  );
}
