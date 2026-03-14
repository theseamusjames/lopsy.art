import { useCallback, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { ColorSwatch } from '../../components/ColorSwatch/ColorSwatch';
import { ColorPicker } from '../../components/ColorPicker/ColorPicker';
import { Slider } from '../../components/Slider/Slider';
import { IconButton } from '../../components/IconButton/IconButton';
import type { Color } from '../../types';
import styles from './ColorPanel.module.css';

interface ColorPanelProps {
  foregroundColor: Color;
  backgroundColor: Color;
  recentColors: readonly Color[];
  onForegroundChange: (color: Color) => void;
  onBackgroundChange: (color: Color) => void;
  onSwap: () => void;
  collapsed?: boolean;
}

function colorToHex(c: Color): string {
  const r = c.r.toString(16).padStart(2, '0');
  const g = c.g.toString(16).padStart(2, '0');
  const b = c.b.toString(16).padStart(2, '0');
  return `${r}${g}${b}`;
}

function hexToColor(hex: string): Color | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r, g, b, a: 1 };
}

export function ColorPanel({
  foregroundColor,
  backgroundColor,
  recentColors,
  onForegroundChange,
  onBackgroundChange,
  onSwap,
  collapsed = false,
}: ColorPanelProps) {
  const [hexInput, setHexInput] = useState(colorToHex(foregroundColor));
  const [editingBg, setEditingBg] = useState(false);

  const activeColor = editingBg ? backgroundColor : foregroundColor;
  const onActiveChange = editingBg ? onBackgroundChange : onForegroundChange;

  const handleHexBlur = useCallback(() => {
    const parsed = hexToColor(hexInput);
    if (parsed) {
      onActiveChange({ ...parsed, a: activeColor.a });
    } else {
      setHexInput(colorToHex(activeColor));
    }
  }, [hexInput, activeColor, onActiveChange]);

  const handleHexKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleHexBlur();
      }
    },
    [handleHexBlur],
  );

  const handlePickerChange = useCallback(
    (c: Color) => {
      onActiveChange(c);
      setHexInput(colorToHex(c));
    },
    [onActiveChange],
  );

  const updateChannel = useCallback(
    (channel: 'r' | 'g' | 'b', value: number) => {
      const next = { ...activeColor, [channel]: value };
      onActiveChange(next);
      setHexInput(colorToHex(next));
    },
    [activeColor, onActiveChange],
  );

  const handleRecentClick = useCallback(
    (color: Color) => {
      onActiveChange(color);
      setHexInput(colorToHex(color));
    },
    [onActiveChange],
  );

  return (
    <div className={styles.panel}>
      <div className={styles.topRow}>
        <div className={styles.swatches}>
          <div className={styles.colorStack}>
            <div className={styles.foreground}>
              <ColorSwatch
                color={foregroundColor}
                size="md"
                isActive={!editingBg}
                onClick={() => setEditingBg(false)}
              />
            </div>
            <div className={styles.background}>
              <ColorSwatch
                color={backgroundColor}
                size="sm"
                isActive={editingBg}
                onClick={() => setEditingBg(true)}
              />
            </div>
          </div>
          <IconButton
            icon={<ArrowUpDown size={14} />}
            label="Swap Colors (X)"
            onClick={onSwap}
            size="sm"
          />
        </div>
        {recentColors.length > 0 && (
          <div className={styles.recentSwatches} data-testid="recent-swatches">
            {recentColors.map((color, i) => (
              <ColorSwatch
                key={i}
                color={color}
                size="sm"
                onClick={() => handleRecentClick(color)}
              />
            ))}
          </div>
        )}
      </div>
      {!collapsed && <ColorPicker color={activeColor} onChange={handlePickerChange} />}
      {!collapsed && <div className={styles.hexRow}>
        <span className={styles.hexLabel}>#</span>
        <input
          className={styles.hexInput}
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={handleHexBlur}
          onKeyDown={handleHexKeyDown}
          maxLength={6}
        />
      </div>}
      {!collapsed && <div className={styles.sliders}>
        <Slider
          label="R"
          value={activeColor.r}
          min={0}
          max={255}
          onChange={(v) => updateChannel('r', v)}
        />
        <Slider
          label="G"
          value={activeColor.g}
          min={0}
          max={255}
          onChange={(v) => updateChannel('g', v)}
        />
        <Slider
          label="B"
          value={activeColor.b}
          min={0}
          max={255}
          onChange={(v) => updateChannel('b', v)}
        />
        <Slider
          label="A"
          value={Math.round(activeColor.a * 100)}
          min={0}
          max={100}
          onChange={(v) => onActiveChange({ ...activeColor, a: v / 100 })}
          showValue
        />
      </div>}
    </div>
  );
}
