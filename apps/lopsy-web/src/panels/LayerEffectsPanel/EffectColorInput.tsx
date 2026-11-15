import { useEffect, useRef } from 'react';
import type { Color } from '../../types';
import { colorToHex, hexToColor } from './color-convert';
import styles from './LayerEffectsPanel.module.css';

interface EffectColorInputProps {
  color: Color;
  ariaLabel: string;
  onChange: (color: Color) => void;
  onEditStart?: () => void;
}

// A native picker fires `input` on every drag tick and a single `change`
// when it closes, so history is pushed once per picker session (on the
// first tick) rather than once per tick.
export function EffectColorInput({ color, ariaLabel, onChange, onEditStart }: EffectColorInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isEditingRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const handleSessionEnd = () => {
      isEditingRef.current = false;
    };
    input.addEventListener('change', handleSessionEnd);
    input.addEventListener('blur', handleSessionEnd);
    return () => {
      input.removeEventListener('change', handleSessionEnd);
      input.removeEventListener('blur', handleSessionEnd);
    };
  }, []);

  return (
    <label className={styles.colorSwatch} style={{ '--swatch-color': `rgb(${color.r}, ${color.g}, ${color.b})` } as React.CSSProperties}>
      <input
        ref={inputRef}
        type="color"
        className={styles.colorInput}
        value={colorToHex(color)}
        aria-label={ariaLabel}
        onChange={(e) => {
          if (!isEditingRef.current) {
            isEditingRef.current = true;
            onEditStart?.();
          }
          onChange(hexToColor(e.target.value, color.a));
        }}
      />
    </label>
  );
}
