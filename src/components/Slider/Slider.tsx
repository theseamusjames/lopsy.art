import { useCallback, useState } from 'react';
import styles from './Slider.module.css';

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
  defaultValue?: number;
  onChange: (value: number) => void;
  showValue?: boolean;
  suffix?: string;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  label,
  defaultValue,
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
        const next = value + step;
        onChange(next);
        setLocalValue(String(next));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = value - step;
        onChange(next);
        setLocalValue(String(next));
      }
    },
    [value, step, onChange],
  );

  return (
    <div className={styles.container} onDoubleClick={handleDoubleClick}>
      {label && <span className={styles.label}>{label}</span>}
      <input
        type="range"
        className={styles.slider}
        value={Math.max(min, Math.min(max, value))}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
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
