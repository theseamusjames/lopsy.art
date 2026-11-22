import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ZOOM_SCRUB_MAX, ZOOM_SCRUB_MIN, steppedZoom } from '@lopsy/ui/ZoomReadout';
import { formatZoom, parseZoomText } from '../zoom-text';
import styles from './ZoomField.module.css';

export interface ZoomFieldProps {
  /** The zoom, 1 for 100 %. */
  readonly zoom: number;
  /** A typed or stepped zoom, within `min` and `max`. */
  readonly onZoom: (zoom: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly isDisabled?: boolean;
  /** The tooltip, and what a screen reader says after the level. */
  readonly hint?: string;
  readonly 'data-testid'?: string;
}

/**
 * The zoom level under the photo, as a field to type in: a percentage,
 * taken on Enter or on leaving the field and held within the range; what
 * is not a number puts the level back. Up and Down step to the next 10 %,
 * Escape drops what was typed. Until something is typed the field follows
 * the zoom, so a wheel zoom with the field focused is not undone by
 * leaving it.
 */
export function ZoomField({
  zoom,
  onZoom,
  min = ZOOM_SCRUB_MIN,
  max = ZOOM_SCRUB_MAX,
  isDisabled = false,
  hint = 'Type a zoom level and press Enter',
  'data-testid': testId,
}: ZoomFieldProps) {
  /** What has been typed and not yet taken; null while the field shows the zoom. */
  const [typed, setTyped] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectNext = useRef(false);
  const hintId = useId();
  const shown = formatZoom(zoom);

  // After Enter, a step or Escape the field keeps focus with its new text selected, ready for the next level.
  useLayoutEffect(() => {
    if (!selectNext.current) return;
    selectNext.current = false;
    inputRef.current?.select();
  });

  const take = (text: string) => {
    const next = parseZoomText(text, min, max);
    if (next !== null && formatZoom(next) !== shown) onZoom(next);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (typed !== null) take(typed);
    } else if (e.key === 'Escape') {
      // Drops what was typed. The view leaves keys pressed in a field alone, so this does not close it.
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      onZoom(steppedZoom(zoom, e.key === 'ArrowUp' ? 1 : -1, min, max));
    } else {
      return;
    }
    setTyped(null);
    selectNext.current = true;
  };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        className={styles.field}
        aria-label="Zoom"
        aria-describedby={hintId}
        title={hint}
        value={typed ?? shown}
        disabled={isDisabled}
        data-testid={testId}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setTyped(e.target.value)}
        onBlur={() => {
          if (typed !== null) take(typed);
          setTyped(null);
        }}
        onKeyDown={handleKeyDown}
      />
      <span id={hintId} className={styles.hint}>
        {hint}. Up and Down step by 10%.
      </span>
    </>
  );
}
