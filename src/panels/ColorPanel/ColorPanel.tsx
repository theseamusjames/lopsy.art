import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { ColorSwatch } from '../../components/ColorSwatch/ColorSwatch';
import { ColorPicker } from '../../components/ColorPicker/ColorPicker';
import { Slider } from '../../components/Slider/Slider';
import { IconButton } from '../../components/IconButton/IconButton';
import { rgbToHex6, hexToRgb } from '../../utils/color';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useEditorStore } from '../../app/editor-store';
import { convertColorToDocMode } from '../../utils/color-mode';
import { rgbToLab, labToRgb, rgbToCmyk, cmykToRgb } from '../../utils/color-spaces';
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
  const foregroundColor = useToolSettingsStore((s) => s.foregroundColor);
  const backgroundColor = useToolSettingsStore((s) => s.backgroundColor);
  const recentColors = useToolSettingsStore((s) => s.recentColors);
  const onForegroundChange = useToolSettingsStore((s) => s.setForegroundColor);
  const onBackgroundChange = useToolSettingsStore((s) => s.setBackgroundColor);
  const onSwap = useToolSettingsStore((s) => s.swapColors);
  const colorMode = useEditorStore((s) => s.document.colorMode);
  const indexedPalette = useEditorStore((s) => s.document.indexedPalette);
  const [hexInput, setHexInput] = useState(colorToHex(foregroundColor));
  const [editingBg, setEditingBg] = useState(false);

  const isGrayscale = colorMode === 'grayscale';
  const isIndexed = colorMode === 'indexed';
  const isLab = colorMode === 'lab';
  const isCmyk = colorMode === 'cmyk';
  const activeColor = editingBg ? backgroundColor : foregroundColor;
  const setActiveColor = editingBg ? onBackgroundChange : onForegroundChange;
  // Lab and CMYK documents store sRGB but edit in their own units, so the
  // sliders derive from the active color on every render.
  const lab = useMemo(() => rgbToLab(activeColor), [activeColor]);
  const cmyk = useMemo(() => rgbToCmyk(activeColor), [activeColor]);
  // In grayscale documents the picker can only express neutral values, so
  // clamp every path that writes a color (hex, sliders, recent swatches).
  const onActiveChange = useCallback(
    (c: Color) => setActiveColor(convertColorToDocMode(c, colorMode, indexedPalette)),
    [setActiveColor, colorMode, indexedPalette],
  );

  useEffect(() => {
    setHexInput(colorToHex(activeColor));
  }, [activeColor]);

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
      </div>
      {isIndexed ? (
        <div className={styles.palette} role="listbox" aria-label="Document palette" data-testid="indexed-palette">
          {(indexedPalette ?? []).map((color, i) => (
            <ColorSwatch
              key={i}
              color={color}
              size="sm"
              isActive={
                color.r === activeColor.r && color.g === activeColor.g && color.b === activeColor.b
              }
              onClick={() => handleRecentClick(color)}
            />
          ))}
        </div>
      ) : (
        <ColorPicker color={activeColor} onChange={handlePickerChange} grayscale={isGrayscale} />
      )}
      <div className={styles.hexRow}>
        <span className={styles.hexLabel} aria-hidden="true">#</span>
        <input
          className={styles.hexInput}
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={handleHexBlur}
          onKeyDown={handleHexKeyDown}
          maxLength={6}
          aria-label="Hex color value"
        />
      </div>
      <div className={styles.sliders}>
        {isGrayscale && (
          <Slider
            label="K"
            value={activeColor.r}
            min={0}
            max={255}
            onChange={(v) => onActiveChange({ r: v, g: v, b: v, a: activeColor.a })}
          />
        )}
        {isLab && (
          <>
            <Slider label="L" value={Math.round(lab.l)} min={0} max={100}
              onChange={(v) => onActiveChange(labToRgb({ ...lab, l: v }, activeColor.a))} showValue />
            <Slider label="a" value={Math.round(lab.a)} min={-128} max={127}
              onChange={(v) => onActiveChange(labToRgb({ ...lab, a: v }, activeColor.a))} showValue />
            <Slider label="b" value={Math.round(lab.b)} min={-128} max={127}
              onChange={(v) => onActiveChange(labToRgb({ ...lab, b: v }, activeColor.a))} showValue />
          </>
        )}
        {isCmyk && (
          <>
            <Slider label="C" value={Math.round(cmyk.c)} min={0} max={100}
              onChange={(v) => onActiveChange(cmykToRgb({ ...cmyk, c: v }, activeColor.a))} showValue />
            <Slider label="M" value={Math.round(cmyk.m)} min={0} max={100}
              onChange={(v) => onActiveChange(cmykToRgb({ ...cmyk, m: v }, activeColor.a))} showValue />
            <Slider label="Y" value={Math.round(cmyk.y)} min={0} max={100}
              onChange={(v) => onActiveChange(cmykToRgb({ ...cmyk, y: v }, activeColor.a))} showValue />
            <Slider label="K" value={Math.round(cmyk.k)} min={0} max={100}
              onChange={(v) => onActiveChange(cmykToRgb({ ...cmyk, k: v }, activeColor.a))} showValue />
          </>
        )}
        {!isGrayscale && !isLab && !isCmyk && (
          <>
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
          </>
        )}
        <Slider
          label="A"
          value={Math.round(activeColor.a * 100)}
          min={0}
          max={100}
          onChange={(v) => onActiveChange({ ...activeColor, a: v / 100 })}
          showValue
        />
      </div>
    </div>
  );
}
