import { useCallback, useRef } from 'react';
import { useToolSettingsStore, abrBrushToPreset } from '../../app/tool-settings-store';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { Slider } from '../Slider/Slider';
import { AngleControl } from './AngleControl';
import { BrushPreview } from './BrushPreview';
import { BrushThumbnail } from './BrushThumbnail';
import type { BrushTipData, BrushTextureBlendMode } from '../../types/brush';
import { describeError, notifyError } from '../../app/notifications-store';
import { docScaledMax } from '../../utils/slider-ranges';
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

  const sizeJitter = useToolSettingsStore((s) => s.brushSizeJitter);
  const angleJitter = useToolSettingsStore((s) => s.brushAngleJitter);
  const opacityJitter = useToolSettingsStore((s) => s.brushOpacityJitter);
  const speedSize = useToolSettingsStore((s) => s.brushSpeedSize);
  const setSizeJitter = useToolSettingsStore((s) => s.setBrushSizeJitter);
  const setAngleJitter = useToolSettingsStore((s) => s.setBrushAngleJitter);
  const setOpacityJitter = useToolSettingsStore((s) => s.setBrushOpacityJitter);
  const setSpeedSize = useToolSettingsStore((s) => s.setBrushSpeedSize);

  const textureData = useToolSettingsStore((s) => s.brushTextureData);
  const textureBlendMode = useToolSettingsStore((s) => s.brushTextureBlendMode);
  const textureScale = useToolSettingsStore((s) => s.brushTextureScale);
  const textures = useToolSettingsStore((s) => s.brushTextures);
  const setTextureData = useToolSettingsStore((s) => s.setBrushTextureData);
  const setTextureBlendMode = useToolSettingsStore((s) => s.setBrushTextureBlendMode);
  const setTextureScale = useToolSettingsStore((s) => s.setBrushTextureScale);

  const activePreset = presets.find((p) => p.id === activePresetId);
  const isActiveCustom = activePreset?.isCustom ?? false;

  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 2000);

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

  const handleTextureChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id === 'none') {
      setTextureData(null);
    } else {
      const tex = textures.find((t) => t.id === id);
      if (tex) setTextureData(tex);
    }
  }, [textures, setTextureData]);

  const handleBlendModeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setTextureBlendMode(e.target.value as BrushTextureBlendMode);
  }, [setTextureBlendMode]);

  return (
    <div className={styles.overlay} onMouseDown={handleOverlayClick}>
      <div className={styles.modal} role="dialog" aria-label="Brushes">
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
                  aria-label={`Brush preset: ${preset.name}`}
                  aria-pressed={preset.id === activePresetId}
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
              aria-label="Import ABR brush file"
              onChange={handleFileChange}
            />
          </div>
          <div className={styles.rightPanel}>
            <div className={styles.sliderSection}>
              <Slider label="Size" value={brushSize} min={1} max={sizeMax} onChange={setBrushSize} />
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

            <div className={styles.sectionLabel}>Dynamics</div>
            <div className={styles.sliderSection}>
              <Slider label="Size Jitter" value={sizeJitter} min={0} max={100} onChange={setSizeJitter} />
              <Slider label="Angle Jitter" value={angleJitter} min={0} max={100} onChange={setAngleJitter} />
              <Slider label="Opacity Jitter" value={opacityJitter} min={0} max={100} onChange={setOpacityJitter} />
              <Slider label="Speed Size" value={speedSize} min={0} max={100} onChange={setSpeedSize} />
            </div>

            <div className={styles.sectionLabel}>Texture</div>
            <div className={styles.textureSection}>
              <select
                className={styles.select}
                value={textureData?.id ?? 'none'}
                onChange={handleTextureChange}
                title="Brush texture"
              >
                <option value="none">No Texture</option>
                {textures.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {textureData && (
                <>
                  <select
                    className={styles.select}
                    value={textureBlendMode}
                    onChange={handleBlendModeChange}
                    title="Texture blend mode"
                  >
                    <option value="multiply">Multiply</option>
                    <option value="subtract">Subtract</option>
                    <option value="overlay">Overlay</option>
                  </select>
                  <Slider label="Scale" value={textureScale} min={10} max={200} onChange={setTextureScale} />
                </>
              )}
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
