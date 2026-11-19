import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { dragValue, formatValue, fraction, keyValue, parseValue, valueText, type SliderRange } from './slider-math';
import styles from './Slider.module.css';

export interface SliderProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  /** Double-click resets to this. */
  readonly defaultValue: number;
  /** Every change while the user moves the slider. */
  readonly onChange: (value: number) => void;
  /** Once, when the user lets go (pointer up, key up, Enter, reset). */
  readonly onCommit: (value: number) => void;
  readonly isDisabled?: boolean;
  /**
   * How the readout shows and reads the value when it is not the value
   * itself (Temperature in Kelvin): the slider keeps its own units.
   */
  readonly display?: SliderDisplay;
  /** Said after the value by screen readers ("EV" for "+0.50 EV"); the readout is unchanged. */
  readonly unit?: string;
}

export interface SliderDisplay {
  readonly format: (value: number) => string;
  /** The value for typed text, or null when it is not one. */
  readonly parse: (text: string) => number | null;
}

interface Drag {
  readonly pointerId: number;
  readonly startX: number;
  readonly startValue: number;
  readonly width: number;
  value: number;
}

const ADJUST_KEYS = new Set(['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']);

/**
 * A labelled slider with a numeric readout. Dragging the track or the label
 * moves the value relative to where it was (Shift for fine control), so a
 * plain click never changes it; double-click resets; arrows step (Shift
 * for ten steps); the readout takes a typed number.
 */
export function Slider({ label, value, min, max, step, defaultValue, onChange, onCommit, isDisabled = false, display, unit }: SliderProps) {
  const range: SliderRange = { min, max, step };
  const id = useId();
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const keyValueRef = useRef<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = (e: PointerEvent<HTMLElement>) => {
    if (isDisabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const width = trackRef.current?.getBoundingClientRect().width ?? 200;
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startValue: value, width, value };
    setIsDragging(true);
    trackRef.current?.focus();
  };

  const handlePointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const next = dragValue(d.startValue, e.clientX - d.startX, d.width, range, e.shiftKey);
    if (next === d.value) return;
    d.value = next;
    onChange(next);
  };

  const handlePointerUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    setIsDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.value !== d.startValue) onCommit(d.value);
  };

  const handleDoubleClick = () => {
    if (isDisabled || value === defaultValue) return;
    onChange(defaultValue);
    onCommit(defaultValue);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isDisabled) return;
    const current = keyValueRef.current ?? value;
    const next = keyValue(current, e.key, e.shiftKey, range);
    if (next === null) return;
    e.preventDefault();
    if (next === current) return;
    keyValueRef.current = next;
    onChange(next);
  };

  const handleKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!ADJUST_KEYS.has(e.key)) return;
    const next = keyValueRef.current;
    keyValueRef.current = null;
    if (next !== null) onCommit(next);
  };

  const commitDraft = () => {
    if (draft === null) return;
    const typed = display ? display.parse(draft) : parseValue(draft, range);
    const parsed = typed === null ? null : Math.min(max, Math.max(min, typed));
    setDraft(null);
    if (parsed === null || parsed === value) return;
    onChange(parsed);
    onCommit(parsed);
  };

  const position = fraction(value, range);
  const origin = fraction(Math.min(max, Math.max(min, min < 0 && max > 0 ? 0 : min)), range);
  const fillStart = Math.min(position, origin);
  const fillEnd = Math.max(position, origin);
  const readout = display ? display.format(value) : formatValue(value, range);

  return (
    <div className={styles.slider} data-disabled={isDisabled || undefined}>
      <div className={styles.header}>
        <span
          className={styles.label}
          id={`${id}-label`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onDoubleClick={handleDoubleClick}
        >
          {label}
        </span>
        <input
          className={styles.readout}
          aria-label={`${label} value`}
          value={draft ?? readout}
          disabled={isDisabled}
          inputMode="decimal"
          onFocus={(e) => {
            setDraft(readout);
            e.currentTarget.select();
          }}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setDraft(null);
              e.currentTarget.blur();
            }
          }}
        />
      </div>
      <div
        ref={trackRef}
        className={styles.track}
        role="slider"
        tabIndex={isDisabled ? -1 : 0}
        aria-labelledby={`${id}-label`}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText(readout, unit)}
        aria-disabled={isDisabled || undefined}
        data-dragging={isDragging || undefined}
        style={
          {
            '--slider-position': `${position * 100}%`,
            '--slider-fill-start': `${fillStart * 100}%`,
            '--slider-fill-end': `${fillEnd * 100}%`,
          } as CSSProperties
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      >
        <div className={styles.fill} />
        <div className={styles.thumb} />
      </div>
    </div>
  );
}
