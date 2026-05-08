import { useCallback, useState } from 'react';
import { clamp } from '../../utils/math';
import styles from './Slider.module.css';

interface SliderProps {
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
  onCommit?: () => void;
  onDragStart?: () => void;
  showValue?: boolean;
  suffix?: string;
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
}: SliderProps) {
  const [localValue, setLocalValue] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);

  const knobMin = Math.max(min, sliderMin ?? min);
  const knobMax = Math.min(max, sliderMax ?? max);

  const handleDoubleClick = () => {
    onChange(defaultValue ?? min);
  };

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    const parsed = parseFloat(localValue);
    if (isNaN(parsed)) {
      setLocalValue(String(value));
    } else {
      const clamped = clamp(parsed, min, max);
      setLocalValue(String(clamped));
      onChange(clamped);
    }
  }, [localValue, value, min, max, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        (e.target as HTMLInputElement).blur();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const raw = scale === 'log' ? nextValueLog(value, step, min, max) : value + step;
        const next = clamp(raw, min, max);
        onChange(next);
        setLocalValue(String(next));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const raw = scale === 'log' ? nextValueLog(value, step, min, max) : value - step;
        const next = clamp(raw, min, max);
        onChange(next);
        setLocalValue(String(next));
      }
    },
    [value, step, onChange, scale, min, max],
  );

  const knobPosition = sliderKnobPosition(value, knobMin, knobMax, scale);

  return (
    <div className={styles.container} onDoubleClick={handleDoubleClick}>
      {label && <span className={styles.label}>{label}</span>}
      <input
        type="range"
        className={styles.slider}
        value={knobPosition}
        min={knobMin}
        max={knobMax}
        step={step}
        aria-label={label ?? 'Value'}
        onChange={(e) => {
          const iv = Number(e.target.value);
          const v = scale === 'log' ? valLog(iv, knobMin, knobMax) : iv;
          onChange(clamp(v, min, max));
        }}
        onPointerDown={() => onDragStart?.()}
        onPointerUp={() => onCommit?.()}
        onKeyUp={() => onCommit?.()}
      />
      {showValue && (
        <div className={styles.valueWrapper}>
          <input
            type="text"
            className={styles.valueInput}
            value={isFocused ? localValue : String(value)}
            aria-label={label ? `${label} value` : 'Value'}
            onChange={(e) => setLocalValue(e.target.value)}
            onFocus={(e) => {
              setIsFocused(true);
              setLocalValue(String(value));
              e.target.select();
            }}
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
