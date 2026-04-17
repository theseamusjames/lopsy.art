import { useCallback, useState } from 'react';
import styles from './Slider.module.css';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
  defaultValue?: number;
  scale?: 'linear' | 'log';
  onChange: (value: number) => void;
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

export function Slider({
  value,
  min,
  max,
  step = 1,
  label,
  defaultValue,
  scale = 'linear',
  onChange,
  showValue = true,
  suffix,
}: SliderProps) {
  const [localValue, setLocalValue] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);

  const handleDoubleClick = () => {
    onChange(defaultValue ?? min);
  };

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    const parsed = parseFloat(localValue);
    if (isNaN(parsed)) {
      setLocalValue(String(value));
    } else {
      setLocalValue(String(parsed));
      onChange(parsed);
    }
  }, [localValue, value, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        (e.target as HTMLInputElement).blur();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = scale === 'log' ? nextValueLog(value, step, min, max) : value + step;
        onChange(next);
        setLocalValue(String(next));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = scale === 'log' ? nextValueLog(value, step, min, max) : value - step;
        onChange(next);
        setLocalValue(String(next));
      }
    },
    [value, step, onChange, scale, min, max],
  );

  // For log scale: the slider knob position is mapped logarithmically.
  // The HTML input stores the knob position, we convert to/from the actual value.
  const inputValue = scale === 'log' ? posLog(value, min, max) : value;

  return (
    <div className={styles.container} onDoubleClick={handleDoubleClick}>
      {label && <span className={styles.label}>{label}</span>}
      <input
        type="range"
        className={styles.slider}
        value={Math.max(min, Math.min(max, inputValue))}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const iv = Number(e.target.value);
          const v = scale === 'log' ? valLog(iv, min, max) : iv;
          onChange(v);
        }}
      />
      {showValue && (
        <div className={styles.valueWrapper}>
          <input
            type="text"
            className={styles.valueInput}
            value={isFocused ? localValue : String(value)}
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
