import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Upload } from 'lucide-react';
import { Slider } from '../Slider/Slider';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import { getBuiltinPresets, parseCubeFile } from '../../filters/color-lut';
import type { LutPreset } from '../../filters/color-lut';
import styles from './ColorLutDialog.module.css';

interface ColorLutDialogProps {
  onApply: (preset: LutPreset, intensity: number) => void;
  onCancel: () => void;
  onPreviewChange?: (preset: LutPreset, intensity: number) => void;
  onPreviewStart?: () => void;
  onPreviewStop?: () => void;
}

function PresetSwatch({ preset }: { preset: LutPreset }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = 80;
    const h = 50;
    canvas.width = w;
    canvas.height = h;

    const imgData = ctx.createImageData(w, h);
    const stripW = preset.size * preset.size;
    const maxIdx = preset.size - 1;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const rIn = px / (w - 1);
        const bIn = py / (h - 1);
        const gIn = 0.5;

        const blueScaled = bIn * maxIdx;
        const slice0 = Math.floor(blueScaled);
        const slice1 = Math.min(slice0 + 1, maxIdx);
        const blueFrac = blueScaled - slice0;

        const redIdx = Math.round(rIn * maxIdx);
        const greenIdx = Math.round(gIn * maxIdx);

        const x0 = slice0 * preset.size + redIdx;
        const x1 = slice1 * preset.size + redIdx;
        const y = greenIdx;

        const i0 = (y * stripW + x0) * 4;
        const i1 = (y * stripW + x1) * 4;

        const outIdx = (py * w + px) * 4;
        imgData.data[outIdx] = (preset.data[i0] ?? 0) * (1 - blueFrac) + (preset.data[i1] ?? 0) * blueFrac;
        imgData.data[outIdx + 1] = (preset.data[i0 + 1] ?? 0) * (1 - blueFrac) + (preset.data[i1 + 1] ?? 0) * blueFrac;
        imgData.data[outIdx + 2] = (preset.data[i0 + 2] ?? 0) * (1 - blueFrac) + (preset.data[i1 + 2] ?? 0) * blueFrac;
        imgData.data[outIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }, [preset]);

  return <canvas ref={canvasRef} className={styles.presetSwatch} />;
}

export function ColorLutDialog({ onApply, onCancel, onPreviewChange, onPreviewStart, onPreviewStop }: ColorLutDialogProps) {
  const presets = useMemo(() => getBuiltinPresets(), []);
  const [selectedPreset, setSelectedPreset] = useState<LutPreset>(() => presets[0]!);
  const [importedPreset, setImportedPreset] = useState<LutPreset | null>(null);
  const [intensity, setIntensity] = useState(100);
  const [preview, setPreview] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewActiveRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!preview || !onPreviewChange) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onPreviewChange(selectedPreset, intensity / 100);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [selectedPreset, intensity, preview, onPreviewChange]);

  const handlePresetSelect = useCallback((preset: LutPreset) => {
    setSelectedPreset(preset);
  }, []);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      const parsed = parseCubeFile(text);
      if (parsed) {
        setImportedPreset(parsed);
        setSelectedPreset(parsed);
      }
    };
    reader.readAsText(file);

    e.target.value = '';
  }, []);

  const handlePreviewToggle = useCallback(() => {
    setPreview((prev) => {
      const next = !prev;
      if (next) {
        previewActiveRef.current = true;
        onPreviewStart?.();
        if (onPreviewChange) {
          setTimeout(() => onPreviewChange(selectedPreset, intensity / 100), 0);
        }
      } else {
        previewActiveRef.current = false;
        onPreviewStop?.();
      }
      return next;
    });
  }, [onPreviewStart, onPreviewStop, onPreviewChange, selectedPreset, intensity]);

  const handleApply = useCallback(() => {
    onApply(selectedPreset, intensity / 100);
  }, [onApply, selectedPreset, intensity]);

  const handleCancel = useCallback(() => {
    if (previewActiveRef.current) {
      onPreviewStop?.();
    }
    onCancel();
  }, [onCancel, onPreviewStop]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleApply, handleCancel]);

  const { offset, dragProps } = useDraggablePanel();

  const allPresets = importedPreset ? [...presets, importedPreset] : presets;

  return (
    <div className={`${styles.overlay} ${preview ? styles.overlayTransparent : ''}`} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-label="Color LUT"
        onKeyDown={handleKeyDown}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      >
        <div className={styles.header} {...dragProps}>
          <h2>Color LUT</h2>
        </div>
        <div className={styles.body}>
          <span className={styles.sectionLabel}>Presets</span>
          <div className={styles.presetGrid}>
            {allPresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`${styles.presetButton} ${selectedPreset.id === preset.id ? styles.presetButtonActive : ''}`}
                onClick={() => handlePresetSelect(preset)}
              >
                <PresetSwatch preset={preset} />
                <span className={styles.presetName}>{preset.name}</span>
              </button>
            ))}
          </div>
          <div className={styles.importRow}>
            <button type="button" className={styles.importButton} onClick={handleImport}>
              <Upload size={14} />
              Import .cube
            </button>
            {importedPreset && (
              <span className={styles.importedName}>{importedPreset.name}</span>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".cube"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <Slider
            label="Intensity"
            value={intensity}
            min={0}
            max={100}
            step={1}
            onChange={setIntensity}
          />
        </div>
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <label className={styles.previewLabel}>
              <input
                type="checkbox"
                checked={preview}
                onChange={handlePreviewToggle}
                className={styles.previewCheckbox}
              />
              Preview
            </label>
          </div>
          <div className={styles.footerButtons}>
            <button className={styles.cancelButton} onClick={handleCancel} type="button">
              Cancel
            </button>
            <button className={styles.applyButton} onClick={handleApply} type="button">
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
