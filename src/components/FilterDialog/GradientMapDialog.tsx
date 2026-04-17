import { useState, useCallback, useRef } from 'react';
import { Slider } from '../Slider/Slider';
import styles from './GradientMapDialog.module.css';

interface GradientStop {
  position: number;
  color: [number, number, number, number];
}

interface GradientPreset {
  name: string;
  stops: GradientStop[];
}

const PRESETS: GradientPreset[] = [
  {
    name: 'Sepia',
    stops: [
      { position: 0, color: [0.12, 0.07, 0.03, 1] },
      { position: 0.5, color: [0.65, 0.45, 0.25, 1] },
      { position: 1, color: [1.0, 0.95, 0.85, 1] },
    ],
  },
  {
    name: 'Cool Tone',
    stops: [
      { position: 0, color: [0.0, 0.02, 0.1, 1] },
      { position: 0.4, color: [0.15, 0.25, 0.55, 1] },
      { position: 0.7, color: [0.5, 0.7, 0.85, 1] },
      { position: 1, color: [0.9, 0.95, 1.0, 1] },
    ],
  },
  {
    name: 'Warm Sunset',
    stops: [
      { position: 0, color: [0.1, 0.0, 0.05, 1] },
      { position: 0.3, color: [0.6, 0.1, 0.15, 1] },
      { position: 0.6, color: [0.95, 0.5, 0.1, 1] },
      { position: 1, color: [1.0, 0.95, 0.6, 1] },
    ],
  },
  {
    name: 'Infrared',
    stops: [
      { position: 0, color: [0.0, 0.0, 0.15, 1] },
      { position: 0.25, color: [0.4, 0.0, 0.3, 1] },
      { position: 0.5, color: [0.8, 0.1, 0.2, 1] },
      { position: 0.75, color: [1.0, 0.6, 0.0, 1] },
      { position: 1, color: [1.0, 1.0, 0.7, 1] },
    ],
  },
  {
    name: 'Duotone Blue',
    stops: [
      { position: 0, color: [0.05, 0.05, 0.2, 1] },
      { position: 1, color: [0.6, 0.85, 1.0, 1] },
    ],
  },
  {
    name: 'Duotone Green',
    stops: [
      { position: 0, color: [0.02, 0.1, 0.05, 1] },
      { position: 1, color: [0.5, 1.0, 0.6, 1] },
    ],
  },
  {
    name: 'Duotone Pink',
    stops: [
      { position: 0, color: [0.15, 0.0, 0.1, 1] },
      { position: 1, color: [1.0, 0.6, 0.8, 1] },
    ],
  },
  {
    name: 'Neon',
    stops: [
      { position: 0, color: [0.0, 0.0, 0.0, 1] },
      { position: 0.25, color: [0.0, 0.0, 0.8, 1] },
      { position: 0.5, color: [0.9, 0.0, 0.9, 1] },
      { position: 0.75, color: [1.0, 0.4, 0.0, 1] },
      { position: 1, color: [1.0, 1.0, 0.0, 1] },
    ],
  },
];

function gradientCss(stops: GradientStop[]): string {
  const parts = stops.map((s) => {
    const r = Math.round(s.color[0] * 255);
    const g = Math.round(s.color[1] * 255);
    const b = Math.round(s.color[2] * 255);
    return `rgb(${r}, ${g}, ${b}) ${s.position * 100}%`;
  });
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

interface GradientMapDialogProps {
  onApply: (preset: GradientPreset, mix: number) => void;
  onCancel: () => void;
  onPreviewChange?: (preset: GradientPreset, mix: number) => void;
  onPreviewStart?: () => void;
  onPreviewStop?: () => void;
}

export type { GradientMapDialogProps, GradientPreset, GradientStop };

export { PRESETS as GRADIENT_MAP_PRESETS };

export function GradientMapDialog({
  onApply,
  onCancel,
  onPreviewChange,
  onPreviewStart,
  onPreviewStop,
}: GradientMapDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mix, setMix] = useState(100);
  const [preview, setPreview] = useState(false);
  const previewActiveRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // PRESETS is a constant array so the index is always valid
  const selectedPreset = PRESETS[selectedIndex] as GradientPreset;

  const triggerPreview = useCallback(
    (preset: GradientPreset, mixVal: number) => {
      if (!previewActiveRef.current || !onPreviewChange) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onPreviewChange(preset, mixVal / 100);
      }, 100);
    },
    [onPreviewChange],
  );

  const handleSelectPreset = useCallback(
    (index: number) => {
      setSelectedIndex(index);
      const preset = PRESETS[index] as GradientPreset;
      triggerPreview(preset, mix);
    },
    [mix, triggerPreview],
  );

  const handleMixChange = useCallback(
    (value: number) => {
      setMix(value);
      triggerPreview(selectedPreset, value);
    },
    [selectedPreset, triggerPreview],
  );

  const handlePreviewToggle = useCallback(() => {
    setPreview((prev) => {
      const next = !prev;
      if (next) {
        previewActiveRef.current = true;
        onPreviewStart?.();
        if (onPreviewChange) {
          setTimeout(() => onPreviewChange(selectedPreset, mix / 100), 0);
        }
      } else {
        previewActiveRef.current = false;
        onPreviewStop?.();
      }
      return next;
    });
  }, [onPreviewStart, onPreviewStop, onPreviewChange, selectedPreset, mix]);

  const handleApply = useCallback(() => {
    onApply(selectedPreset, mix / 100);
  }, [onApply, selectedPreset, mix]);

  const handleCancel = useCallback(() => {
    if (previewActiveRef.current) {
      onPreviewStop?.();
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onCancel();
  }, [onCancel, onPreviewStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleApply();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleApply, handleCancel],
  );

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} onKeyDown={handleKeyDown}>
        <div className={styles.header}>
          <h2>Gradient Map</h2>
        </div>
        <div className={styles.body}>
          <div className={styles.presetsGrid}>
            {PRESETS.map((preset, i) => (
              <button
                key={preset.name}
                type="button"
                className={`${styles.presetButton} ${i === selectedIndex ? styles.presetButtonSelected : ''}`}
                onClick={() => handleSelectPreset(i)}
                title={preset.name}
              >
                <div
                  className={styles.presetSwatch}
                  style={{ background: gradientCss(preset.stops) }}
                />
                <span className={styles.presetName}>{preset.name}</span>
              </button>
            ))}
          </div>
          <div className={styles.mixRow}>
            <Slider label="Mix" value={mix} min={0} max={100} step={1} onChange={handleMixChange} />
          </div>
        </div>
        <div className={styles.footer}>
          <label className={styles.previewLabel}>
            <input
              type="checkbox"
              checked={preview}
              onChange={handlePreviewToggle}
              className={styles.previewCheckbox}
            />
            Preview
          </label>
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
