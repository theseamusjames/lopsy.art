import { useCallback, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { ColorSwatch } from '../../components/ColorSwatch/ColorSwatch';
import { ColorPicker } from '../../components/ColorPicker/ColorPicker';
import { Slider } from '../../components/Slider/Slider';
import { IconButton } from '../../components/IconButton/IconButton';
import { rgbToHex6, hexToRgb } from '../../utils/color';
import { useUIStore } from '../../app/ui-store';
import { PanelContainer } from '../PanelContainer/PanelContainer';
import { usePanelCollapse } from '../usePanelCollapse';
import type { Color } from '../../types';
import styles from './ColorPanel.module.css';

/** Hex string without # prefix for the text input field. */
function colorToHex(c: Color): string {
  return rgbToHex6(c).slice(1);
}

function hexToColor(hex: string): Color | null {
  return hexToRgb(hex);
}

export function ColorPanel() {
  const [collapsed, setCollapsed] = usePanelCollapse('color');
  const foregroundColor = useUIStore((s) => s.foregroundColor);
  const backgroundColor = useUIStore((s) => s.backgroundColor);
  const recentColors = useUIStore((s) => s.recentColors);
  const onForegroundChange = useUIStore((s) => s.setForegroundColor);
  const onBackgroundChange = useUIStore((s) => s.setBackgroundColor);
  const onSwap = useUIStore((s) => s.swapColors);
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
    <PanelContainer title="Color" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)}>
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
    </PanelContainer>
  );
}
