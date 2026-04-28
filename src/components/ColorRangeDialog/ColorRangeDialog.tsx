import { useState, useCallback, useEffect, useRef } from 'react';
import { Slider } from '../Slider/Slider';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { useEditorStore } from '../../app/editor-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { readLayerPixelsForFill } from '../../engine-wasm/wasm-bridge';
import { colorRangeSelect } from '../../selection/color-range';
import type { Color } from '../../types';
import styles from './ColorRangeDialog.module.css';

interface ColorRangeDialogProps {
  onApply: (mask: Uint8ClampedArray, width: number, height: number) => void;
  onCancel: () => void;
}

export function ColorRangeDialog({ onApply, onCancel }: ColorRangeDialogProps) {
  const foregroundColor = useToolSettingsStore((s) => s.foregroundColor);
  const [fuzziness, setFuzziness] = useState(40);
  const [targetColor, setTargetColor] = useState<Color>(foregroundColor);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelCacheRef = useRef<{ data: Uint8Array; width: number; height: number } | null>(null);

  const readPixels = useCallback(() => {
    if (pixelCacheRef.current) return pixelCacheRef.current;
    const engine = getEngine();
    if (!engine) return null;
    const state = useEditorStore.getState();
    const activeLayerId = state.document.activeLayerId;
    if (!activeLayerId) return null;
    const { width, height } = state.document;
    const data = readLayerPixelsForFill(engine, activeLayerId);
    const result = { data, width, height };
    pixelCacheRef.current = result;
    return result;
  }, []);

  const updatePreview = useCallback((color: Color, fuzz: number) => {
    const pixels = readPixels();
    if (!pixels) return;
    const { data, width, height } = pixels;
    const mask = colorRangeSelect(data, width, height, color, fuzz);

    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imgData = ctx.createImageData(width, height);
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i] ?? 0;
      imgData.data[i * 4] = v;
      imgData.data[i * 4 + 1] = v;
      imgData.data[i * 4 + 2] = v;
      imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
  }, [readPixels]);

  useEffect(() => {
    updatePreview(targetColor, fuzziness);
  }, [targetColor, fuzziness, updatePreview]);

  useEffect(() => {
    setTargetColor(foregroundColor);
  }, [foregroundColor]);

  const handleFuzzinessChange = useCallback((value: number) => {
    setFuzziness(value);
  }, []);

  const handleApply = useCallback(() => {
    const pixels = readPixels();
    if (!pixels) return;
    const { data, width, height } = pixels;
    const mask = colorRangeSelect(data, width, height, targetColor, fuzziness);
    onApply(mask, width, height);
  }, [readPixels, targetColor, fuzziness, onApply]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [handleApply, onCancel]);

  const { offset, dragProps } = useDraggablePanel();
  const swatchBg = `rgb(${targetColor.r}, ${targetColor.g}, ${targetColor.b})`;

  return (
    <div className={styles.overlay} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Color Range"
        onKeyDown={handleKeyDown}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        {...dragProps}
      >
        <div className={styles.header}>
          <h2>Color Range</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.colorRow}>
            <span className={styles.colorLabel}>Sample Color</span>
            <div className={styles.colorSwatch} style={{ backgroundColor: swatchBg }} />
            <span className={styles.colorValues}>
              {targetColor.r}, {targetColor.g}, {targetColor.b}
            </span>
          </div>
          <Slider
            label="Fuzziness"
            value={fuzziness}
            min={0}
            max={200}
            step={1}
            onChange={handleFuzzinessChange}
          />
          <div className={styles.previewContainer}>
            <span className={styles.previewLabel}>Selection Preview</span>
            <canvas ref={canvasRef} className={styles.previewCanvas} />
          </div>
          <span className={styles.hint}>
            Uses the current foreground color. Pick a color with the Eyedropper tool first, then adjust fuzziness to expand the range.
          </span>
        </div>
        <div className={styles.footer}>
          <button className={styles.cancelButton} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className={styles.applyButton} onClick={handleApply} type="button">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
