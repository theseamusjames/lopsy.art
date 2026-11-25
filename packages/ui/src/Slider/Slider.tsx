import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { useSelectOnFocus } from '../a11y/use-select-on-focus';
import styles from './Slider.module.css';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  sliderMin?: number;
  sliderMax?: number;
  step?: number;
  label?: string;
  defaultValue?: number;
  scale?: 'linear' | 'log';
  onChange: (value: number) => void;
  /** At the end of a change (pointer up, key up, a typed, stepped or reset value), with the value it ended on. */
  onCommit?: (value: number) => void;
  onDragStart?: () => void;
  showValue?: boolean;
  suffix?: string;
  disabled?: boolean;
  /** What the value box shows for a value; `String(value)` by default. */
  format?: (value: number) => string;
  /** The value typed into the value box, or null when the text is not one; `parseFloat` by default. */
  parse?: (text: string) => number | null;
  /** Read after the value by screen readers ("+0.50 EV"); the suffix when there is none. */
  unit?: string;
  /**
   * Where the track's fill starts: it runs from this value to the thumb.
   * Pass the default value where a change from it is what matters (an
   * edit), so a slider left alone shows no fill. By default 0 when the
   * range runs either side of 0, else the minimum.
   */
  fillFrom?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseNumber(text: string): number | null {
  const parsed = parseFloat(text);
  return isNaN(parsed) ? null : parsed;
}

function posLog(v: number, min: number, max: number): number {
  const norm = Math.log(v / min) / Math.log(max / min);
  return min + norm * (max - min);
}

function valLog(inputValue: number, min: number, max: number): number {
  const norm = (inputValue - min) / (max - min);
  return min * Math.pow(max / min, Math.max(0, Math.min(1, norm)));
}

function nextValueLog(v: number, step: number, min: number, max: number): number {
  const norm = Math.log(v / min) / Math.log(max / min);
  const next = Math.max(0, Math.min(1, norm + step));
  return min * Math.pow(max / min, next);
}

export function commitSliderValue(
  input: string,
  currentValue: number,
  min: number,
  max: number,
): number {
  const parsed = parseFloat(input);
  if (isNaN(parsed)) return currentValue;
  return clamp(parsed, min, max);
}

export function sliderKnobPosition(
  value: number,
  sliderMin: number,
  sliderMax: number,
  scale: 'linear' | 'log' = 'linear',
): number {
  const clamped = clamp(value, sliderMin, sliderMax);
  return scale === 'log' ? posLog(clamped, sliderMin, sliderMax) : clamped;
}

/** The thumb's width in the stylesheet: its centre travels from half a thumb in from one end to half a thumb in from the other. */
const THUMB_WIDTH = 20;

/** A fill edge at `fraction` of the way along the track, under the thumb's centre; the ends reach the track's ends. */
function fillEdge(fraction: number): string {
  if (fraction <= 0) return '0%';
  if (fraction >= 1) return '100%';
  return `calc(${THUMB_WIDTH / 2}px + (100% - ${THUMB_WIDTH}px) * ${Number(fraction.toFixed(4))})`;
}

/**
 * Where the track's fill starts and ends, as CSS lengths along the track:
 * from `fillFrom` (by default 0 on a range either side of 0, else the
 * minimum) to the value, in the knob's scale. Equal when they meet.
 */
export function sliderFill(
  value: number,
  knobMin: number,
  knobMax: number,
  scale: 'linear' | 'log' = 'linear',
  fillFrom?: number,
): { from: string; to: string } {
  const at = (v: number) =>
    knobMax === knobMin ? 0 : (sliderKnobPosition(v, knobMin, knobMax, scale) - knobMin) / (knobMax - knobMin);
  const origin = fillFrom ?? (knobMin < 0 && knobMax > 0 ? 0 : knobMin);
  const a = at(origin);
  const b = at(value);
  return { from: fillEdge(Math.min(a, b)), to: fillEdge(Math.max(a, b)) };
}

/** What a screen reader says for the value: the value box's text, then the unit or suffix. */
export function sliderValueText(text: string, unit?: string): string {
  return unit ? `${text} ${unit}` : text;
}

export function Slider({
  value,
  min,
  max,
  sliderMin,
  sliderMax,
  step = 1,
  label,
  defaultValue,
  scale = 'linear',
  onChange,
  onCommit,
  onDragStart,
  showValue = true,
  suffix,
  disabled = false,
  format = String,
  parse = parseNumber,
  unit,
  fillFrom,
}: SliderProps) {
  const [localValue, setLocalValue] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);
  // Typing in the value box replaces the value, also after a click in Safari.
  const selectOnFocus = useSelectOnFocus(() => {
    setIsFocused(true);
    setLocalValue(format(value));
  });
  // The value the last change set, until it is committed: onCommit reports
  // it even when the parent has not re-rendered with it yet.
  const changedTo = useRef<number | null>(null);

  const knobMin = Math.max(min, sliderMin ?? min);
  const knobMax = Math.min(max, sliderMax ?? max);

  const change = useCallback(
    (next: number) => {
      changedTo.current = next;
      onChange(next);
    },
    [onChange],
  );

  const commit = useCallback(() => {
    const committed = changedTo.current ?? value;
    changedTo.current = null;
    onCommit?.(committed);
  }, [value, onCommit]);

  // The value box, its arrow keys, and double-click-reset each apply a
  // single discrete change rather than a continuous drag, but callers that
  // rely on onDragStart/onCommit to bracket a change with history (e.g. text
  // layer restyles, #846) need that bracketing here too — a drag on the
  // range input isn't the only way to change a value.
  const handleDoubleClick = () => {
    if (disabled) return;
    const next = defaultValue ?? min;
    if (next === value) return;
    onDragStart?.();
    change(next);
    commit();
  };

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    const parsed = parse(localValue);
    if (parsed === null) {
      setLocalValue(format(value));
    } else {
      const clamped = clamp(parsed, min, max);
      setLocalValue(format(clamped));
      // Re-entering the current value is a no-op — don't bracket it with a
      // history entry (onDragStart), or every value-box visit would pollute
      // undo with an empty step (#867 regression).
      if (clamped !== value) {
        onDragStart?.();
        change(clamped);
        commit();
      }
    }
  }, [localValue, value, min, max, parse, format, change, onDragStart, commit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        (e.target as HTMLInputElement).blur();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const raw = scale === 'log' ? nextValueLog(value, step, min, max) : value + step;
        const next = clamp(raw, min, max);
        if (next !== value) {
          onDragStart?.();
          change(next);
          commit();
          setLocalValue(format(next));
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const raw = scale === 'log' ? nextValueLog(value, step, min, max) : value - step;
        const next = clamp(raw, min, max);
        if (next !== value) {
          onDragStart?.();
          change(next);
          commit();
          setLocalValue(format(next));
        }
      }
    },
    [value, step, change, scale, min, max, format, onDragStart, commit],
  );

  const knobPosition = sliderKnobPosition(value, knobMin, knobMax, scale);
  const fill = sliderFill(value, knobMin, knobMax, scale, fillFrom);
  return (
    <div className={styles.container} data-disabled={disabled || undefined} onDoubleClick={handleDoubleClick}>
      {label && <span className={styles.label}>{label}</span>}
      <input
        type="range"
        className={styles.slider}
        style={{ '--slider-fill-from': fill.from, '--slider-fill-to': fill.to } as CSSProperties}
        value={knobPosition}
        min={knobMin}
        max={knobMax}
        step={step}
        disabled={disabled}
        aria-label={label ?? 'Value'}
        aria-valuetext={sliderValueText(format(value), unit ?? suffix)}
        onChange={(e) => {
          const iv = Number(e.target.value);
          const v = scale === 'log' ? valLog(iv, knobMin, knobMax) : iv;
          change(clamp(v, min, max));
        }}
        onPointerDown={() => {
          if (disabled) return;
          changedTo.current = null;
          onDragStart?.();
        }}
        onPointerUp={() => {
          if (!disabled) commit();
        }}
        onKeyDown={() => {
          changedTo.current = null;
        }}
        onKeyUp={commit}
      />
      {showValue && (
        <div className={styles.valueWrapper}>
          <input
            type="text"
            className={styles.valueInput}
            value={isFocused ? localValue : format(value)}
            disabled={disabled}
            aria-label={label ? `${label} value` : 'Value'}
            onChange={(e) => setLocalValue(e.target.value)}
            {...selectOnFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
          {suffix && <span className={styles.suffix}>{suffix}</span>}
        </div>
      )}
    </div>
  );
}
