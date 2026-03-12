import { useCallback, useState } from 'react';
import styles from './NumberInput.module.css';

interface NumberInputProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  onChange: (value: number) => void;
  suffix?: string;
}

export function NumberInput({
  value,
  min,
  max,
  step = 1,
  label,
  onChange,
  suffix,
}: NumberInputProps) {
  const [localValue, setLocalValue] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);

  const clamp = useCallback(
    (v: number) => {
      let result = v;
      if (min !== undefined) result = Math.max(min, result);
      if (max !== undefined) result = Math.min(max, result);
      return result;
    },
    [min, max],
  );

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    const parsed = parseFloat(localValue);
    if (isNaN(parsed)) {
      setLocalValue(String(value));
    } else {
      const clamped = clamp(parsed);
      setLocalValue(String(clamped));
      onChange(clamped);
    }
  }, [localValue, value, clamp, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        (e.target as HTMLInputElement).blur();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = clamp(value + step);
        onChange(next);
        setLocalValue(String(next));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = clamp(value - step);
        onChange(next);
        setLocalValue(String(next));
      }
    },
    [value, step, clamp, onChange],
  );

  return (
    <div className={styles.container}>
      {label && <span className={styles.label}>{label}</span>}
      <div className={styles.inputWrapper}>
        <input
          type="text"
          className={styles.input}
          value={isFocused ? localValue : String(value)}
          onChange={(e) => setLocalValue(e.target.value)}
          onFocus={() => {
            setIsFocused(true);
            setLocalValue(String(value));
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
        {suffix && <span className={styles.suffix}>{suffix}</span>}
      </div>
    </div>
  );
}
