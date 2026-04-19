import { useCallback, useRef } from 'react';
import { useToolSettingsStore, abrBrushToPreset } from '../../app/tool-settings-store';
import { useUIStore } from '../../app/ui-store';
import { Slider } from '../Slider/Slider';
import { AngleControl } from './AngleControl';
import { BrushPreview } from './BrushPreview';
import { BrushThumbnail } from './BrushThumbnail';
import type { BrushTipData } from '../../types/brush';
import { describeError, notifyError } from '../../app/notifications-store';
import styles from './BrushModal.module.css';

export function BrushModal() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const presets = useToolSettingsStore((s) => s.presets);
  const activePresetId = useToolSettingsStore((s) => s.activePresetId);
  const setActivePreset = useToolSettingsStore((s) => s.setActivePreset);
  const removePreset = useToolSettingsStore((s) => s.removePreset);
  const addPresets = useToolSettingsStore((s) => s.addPresets);
  const setShowBrushModal = useUIStore((s) => s.setShowBrushModal);

  const brushSize = useToolSettingsStore((s) => s.brushSize);
  const brushOpacity = useToolSettingsStore((s) => s.brushOpacity);
  const brushHardness = useToolSettingsStore((s) => s.brushHardness);
  const brushSpacing = useToolSettingsStore((s) => s.brushSpacing);
  const brushScatter = useToolSettingsStore((s) => s.brushScatter);
  const brushAngle = useToolSettingsStore((s) => s.brushAngle);
  const activeBrushTip = useToolSettingsStore((s) => s.activeBrushTip);

  const setBrushSize = useToolSettingsStore((s) => s.setBrushSize);
  const setBrushOpacity = useToolSettingsStore((s) => s.setBrushOpacity);
  const setBrushHardness = useToolSettingsStore((s) => s.setBrushHardness);
  const setBrushSpacing = useToolSettingsStore((s) => s.setBrushSpacing);
  const setBrushScatter = useToolSettingsStore((s) => s.setBrushScatter);
  const setBrushAngle = useToolSettingsStore((s) => s.setBrushAngle);

  const activePreset = presets.find((p) => p.id === activePresetId);
  const isActiveCustom = activePreset?.isCustom ?? false;

  const handleClose = useCallback(() => {
    setShowBrushModal(false);
  }, [setShowBrushModal]);

  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  }, [handleClose]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onerror = () => {
      notifyError('Failed to read brush file.');
    };
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      const worker = new Worker(
        new URL('../../tools/brush/abr-worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (msg: MessageEvent<Array<{ name: string; width: number; height: number; data: Uint8ClampedArray; spacing?: number }>>) => {
        const brushes = msg.data;
        const newPresets = brushes.map((b) => {
          const tip: BrushTipData = {
            width: b.width,
            height: b.height,
            data: b.data,
          };
          return abrBrushToPreset(b.name, tip, b.spacing);
        });
        addPresets(newPresets);
        worker.terminate();
      };
      worker.onerror = (err) => {
        notifyError(`Failed to parse brush file: ${describeError(err.message ?? err)}`);
        worker.terminate();
      };
      worker.postMessage(buffer, [buffer]);
    };
    reader.readAsArrayBuffer(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [addPresets]);

  const handleDelete = useCallback(() => {
    if (activePresetId && isActiveCustom) {
      removePreset(activePresetId);
    }
  }, [activePresetId, isActiveCustom, removePreset]);

  return (
    <div className={styles.overlay} onMouseDown={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Brushes</h2>
        </div>
        <div className={styles.content}>
          <div className={styles.leftPanel}>
            <div className={styles.presetGrid}>
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  className={`${styles.presetItem}${preset.id === activePresetId ? ` ${styles.presetItemActive}` : ''}`}
                  onClick={() => setActivePreset(preset.id)}
                  title={preset.name}
                >
                  <BrushThumbnail preset={preset} size={44} />
                </button>
              ))}
            </div>
            <div className={styles.presetActions}>
              <button className={styles.importButton} onClick={handleImportClick}>
                Import ABR
              </button>
              <button
                className={styles.deleteButton}
                onClick={handleDelete}
                disabled={!isActiveCustom}
              >
                Delete
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".abr"
              className={styles.hiddenInput}
              onChange={handleFileChange}
            />
          </div>
          <div className={styles.rightPanel}>
            <div className={styles.sliderSection}>
              <Slider label="Size" value={brushSize} min={1} max={2000} onChange={setBrushSize} />
              <Slider label="Spacing" value={brushSpacing} min={1} max={200} onChange={setBrushSpacing} />
              <Slider label="Hardness" value={brushHardness} min={0} max={100} onChange={setBrushHardness} />
              <Slider label="Scatter" value={brushScatter} min={0} max={100} onChange={setBrushScatter} />
              <Slider label="Opacity" value={brushOpacity} min={1} max={100} onChange={setBrushOpacity} />
            </div>
            <div className={styles.angleRow}>
              <AngleControl angle={brushAngle} onAngleChange={setBrushAngle} />
              <BrushPreview
                size={brushSize}
                hardness={brushHardness}
                spacing={brushSpacing}
                opacity={brushOpacity}
                tip={activeBrushTip}
              />
            </div>
          </div>
        </div>
        <div className={styles.footer}>
          <button className={styles.closeButton} onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
