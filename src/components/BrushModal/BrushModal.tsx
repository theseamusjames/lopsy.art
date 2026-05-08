import { useCallback, useRef, useState } from 'react';
import { useToolSettingsStore, abrBrushToPreset } from '../../app/tool-settings-store';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { Slider } from '../Slider/Slider';
import { AngleControl } from './AngleControl';
import { BrushDabPreview } from './BrushDabPreview';
import { BrushThumbnail } from './BrushThumbnail';
import type { BrushTipData, BrushTextureBlendMode } from '../../types/brush';
import { describeError, notifyError } from '../../app/notifications-store';
import { exportPresets, importPresets } from '../../tools/brush/preset-io';
import { docScaledMax } from '../../utils/slider-ranges';
import { BrushStrokePreview } from './BrushStrokePreview';
import styles from './BrushModal.module.css';

type TabKey = 'shape' | 'dynamics' | 'texture';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'shape', label: 'Shape' },
  { key: 'dynamics', label: 'Dynamics' },
  { key: 'texture', label: 'Texture' },
];

let nextTextureId = 1;

export function BrushModal() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textureFileInputRef = useRef<HTMLInputElement>(null);
  const [textureImporting, setTextureImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('shape');

  const presets = useToolSettingsStore((s) => s.presets);
  const activePresetId = useToolSettingsStore((s) => s.activePresetId);
  const setActivePreset = useToolSettingsStore((s) => s.setActivePreset);
  const removePreset = useToolSettingsStore((s) => s.removePreset);
  const addPresets = useToolSettingsStore((s) => s.addPresets);
  const saveCurrentAsPreset = useToolSettingsStore((s) => s.saveCurrentAsPreset);
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
  const brushTaper = useToolSettingsStore((s) => s.brushTaper);
  const setBrushTaper = useToolSettingsStore((s) => s.setBrushTaper);

  const sizeJitter = useToolSettingsStore((s) => s.brushSizeJitter);
  const hardnessJitter = useToolSettingsStore((s) => s.brushHardnessJitter);
  const angleJitter = useToolSettingsStore((s) => s.brushAngleJitter);
  const opacityJitter = useToolSettingsStore((s) => s.brushOpacityJitter);
  const speedSize = useToolSettingsStore((s) => s.brushSpeedSize);
  const speedSizeInvert = useToolSettingsStore((s) => s.brushSpeedSizeInvert);
  const speedSensitivity = useToolSettingsStore((s) => s.brushSpeedSensitivity);
  const setSizeJitter = useToolSettingsStore((s) => s.setBrushSizeJitter);
  const setHardnessJitter = useToolSettingsStore((s) => s.setBrushHardnessJitter);
  const setAngleJitter = useToolSettingsStore((s) => s.setBrushAngleJitter);
  const setOpacityJitter = useToolSettingsStore((s) => s.setBrushOpacityJitter);
  const setSpeedSize = useToolSettingsStore((s) => s.setBrushSpeedSize);
  const setSpeedSizeInvert = useToolSettingsStore((s) => s.setBrushSpeedSizeInvert);
  const setSpeedSensitivity = useToolSettingsStore((s) => s.setBrushSpeedSensitivity);

  const textureData = useToolSettingsStore((s) => s.brushTextureData);
  const textureBlendMode = useToolSettingsStore((s) => s.brushTextureBlendMode);
  const textureScale = useToolSettingsStore((s) => s.brushTextureScale);
  const textures = useToolSettingsStore((s) => s.brushTextures);
  const setTextureData = useToolSettingsStore((s) => s.setBrushTextureData);
  const setTextureBlendMode = useToolSettingsStore((s) => s.setBrushTextureBlendMode);
  const setTextureScale = useToolSettingsStore((s) => s.setBrushTextureScale);
  const addBrushTexture = useToolSettingsStore((s) => s.addBrushTexture);
  const removeBrushTexture = useToolSettingsStore((s) => s.removeBrushTexture);

  const activePreset = presets.find((p) => p.id === activePresetId);
  const isActiveCustom = activePreset?.isCustom ?? false;

  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const taperMax = docScaledMax(docWidth, docHeight, 2000);
  const sizeMax = docScaledMax(docWidth, docHeight, 2000);

  const handleClose = useCallback(() => {
    setShowBrushModal(false);
  }, [setShowBrushModal]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => notifyError('Failed to read brush file.');
    reader.onload = () => {
      const buffer = reader.result as ArrayBuffer;
      const worker = new Worker(
        new URL('../../tools/brush/abr-worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (msg: MessageEvent<Array<{ name: string; width: number; height: number; data: Uint8ClampedArray; spacing?: number }>>) => {
        const newPresets = msg.data.map((b) => {
          const tip: BrushTipData = { width: b.width, height: b.height, data: b.data };
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [addPresets]);

  const handleDelete = useCallback(() => {
    if (activePresetId && isActiveCustom && confirm(`Delete "${activePreset?.name}"?`)) {
      removePreset(activePresetId);
    }
  }, [activePresetId, isActiveCustom, activePreset?.name, removePreset]);

  const handleSavePreset = useCallback(() => {
    const name = prompt('Preset name:');
    if (name) saveCurrentAsPreset(name);
  }, [saveCurrentAsPreset]);

  const handleExportPresets = useCallback(() => {
    exportPresets();
  }, []);

  const handleImportPresets = useCallback(() => {
    importPresets();
  }, []);

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

  const handleTextureImportClick = useCallback(() => {
    textureFileInputRef.current?.click();
  }, []);

  const handleTextureFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTextureImporting(true);
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); setTextureImporting(false); return; }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const grayscale = new Uint8ClampedArray(img.width * img.height);
      for (let i = 0; i < grayscale.length; i++) {
        const r = imageData.data[i * 4]!;
        const g = imageData.data[i * 4 + 1]!;
        const b = imageData.data[i * 4 + 2]!;
        grayscale[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
      const name = file.name.replace(/\.[^.]+$/, '');
      const tex = { id: `texture-custom-${nextTextureId++}`, name, width: img.width, height: img.height, data: grayscale };
      addBrushTexture(tex);
      setTextureData(tex);
      URL.revokeObjectURL(url);
      setTextureImporting(false);
    };
    img.onerror = () => { notifyError('Failed to load texture image.'); URL.revokeObjectURL(url); setTextureImporting(false); };
    img.src = url;
    if (textureFileInputRef.current) textureFileInputRef.current.value = '';
  }, [addBrushTexture, setTextureData]);

  const handleTextureDelete = useCallback(() => {
    if (textureData && textureData.id.startsWith('texture-custom-')) removeBrushTexture(textureData.id);
  }, [textureData, removeBrushTexture]);

  const isCustomTexture = textureData !== null && textureData.id.startsWith('texture-custom-');

  function renderPanel() {
    switch (activeTab) {
      case 'shape':
        return (
          <>
            <div className={styles.galleryStage}>
              <div className={styles.galleryGrid}>
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    className={`${styles.presetItem}${preset.id === activePresetId ? ` ${styles.presetItemActive}` : ''}`}
                    onClick={() => setActivePreset(preset.id)}
                    aria-label={`Brush preset: ${preset.name}`}
                    aria-pressed={preset.id === activePresetId}
                    title={preset.name}
                  >
                    <BrushThumbnail preset={preset} size={36} />
                  </button>
                ))}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".abr"
              className={styles.hiddenInput}
              aria-label="Import ABR brush file"
              onChange={handleFileChange}
            />
            <div className={styles.sliderSection}>
              <Slider label="Size" value={brushSize} min={1} max={sizeMax} onChange={setBrushSize} />
              <Slider label="Spacing" value={brushSpacing} min={1} max={200} onChange={setBrushSpacing} />
              <Slider label="Hardness" value={brushHardness} min={0} max={100} onChange={setBrushHardness} />
              <Slider label="Scatter" value={brushScatter} min={0} max={100} onChange={setBrushScatter} />
              <Slider label="Opacity" value={brushOpacity} min={1} max={100} onChange={setBrushOpacity} />
              <Slider label="Taper" value={brushTaper} min={0} max={taperMax} onChange={setBrushTaper} suffix="px" />
            </div>
            <div className={styles.angleRow}>
              <AngleControl angle={brushAngle} onAngleChange={setBrushAngle} />
              <BrushDabPreview
                size={brushSize}
                hardness={brushHardness}
                opacity={brushOpacity}
                angle={brushAngle}
                tip={activeBrushTip}
              />
            </div>
          </>
        );
      case 'dynamics':
        return (
          <div className={styles.sliderSection}>
            <Slider label="Size Jitter" value={sizeJitter} min={0} max={100} onChange={setSizeJitter} />
            <Slider label="Hardness Jitter" value={hardnessJitter} min={0} max={100} onChange={setHardnessJitter} />
            <Slider label="Angle Jitter" value={angleJitter} min={0} max={100} onChange={setAngleJitter} />
            <Slider label="Opacity Jitter" value={opacityJitter} min={0} max={100} onChange={setOpacityJitter} />
            <Slider label="Speed Size" value={speedSize} min={0} max={speedSizeInvert ? 300 : 100} onChange={setSpeedSize} />
            <div className={styles.speedToggleRow}>
              <span className={styles.speedToggleLabel}>Faster is</span>
              <div className={styles.speedToggleGroup}>
                <button
                  className={`${styles.speedToggle}${!speedSizeInvert ? ` ${styles.speedToggleActive}` : ''}`}
                  onClick={() => { setSpeedSizeInvert(false); if (speedSize > 100) setSpeedSize(100); }}
                >
                  Thinner
                </button>
                <button
                  className={`${styles.speedToggle}${speedSizeInvert ? ` ${styles.speedToggleActive}` : ''}`}
                  onClick={() => setSpeedSizeInvert(true)}
                >
                  Wider
                </button>
              </div>
              <span className={styles.speedToggleLabel}>Sensitivity</span>
              <div className={styles.speedToggleGroup}>
                <button
                  className={`${styles.speedToggle}${speedSensitivity === 'low' ? ` ${styles.speedToggleActive}` : ''}`}
                  onClick={() => setSpeedSensitivity('low')}
                >
                  Low
                </button>
                <button
                  className={`${styles.speedToggle}${speedSensitivity === 'med' ? ` ${styles.speedToggleActive}` : ''}`}
                  onClick={() => setSpeedSensitivity('med')}
                >
                  Med
                </button>
                <button
                  className={`${styles.speedToggle}${speedSensitivity === 'high' ? ` ${styles.speedToggleActive}` : ''}`}
                  onClick={() => setSpeedSensitivity('high')}
                >
                  High
                </button>
              </div>
            </div>
          </div>
        );
      case 'texture':
        return (
          <div className={styles.textureSection}>
            <div className={styles.textureRow}>
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
              <button className={styles.smallButton} onClick={handleTextureImportClick} disabled={textureImporting}>
                {textureImporting ? 'Loading...' : 'Import'}
              </button>
              {isCustomTexture && (
                <button className={styles.smallButton} onClick={handleTextureDelete}>Delete</button>
              )}
            </div>
            <input
              ref={textureFileInputRef}
              type="file"
              accept="image/*"
              className={styles.hiddenInput}
              aria-label="Import texture image"
              onChange={handleTextureFileChange}
            />
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
                <Slider label="Scale" value={textureScale} min={10} max={300} onChange={setTextureScale} />
              </>
            )}
          </div>
        );
    }
  }

  return (
    <div className={styles.panel} role="dialog" aria-label="Brushes">
      <div className={styles.titleBar}>
        <span className={styles.titleText}>Brushes</span>
        <button className={styles.closeX} onClick={handleClose} aria-label="Close">&times;</button>
      </div>
      <div className={styles.tabContainer}>
        <div className={styles.tabList} role="listbox" aria-label="Brush settings">
          {TABS.map(({ key, label }) => (
            <div
              key={key}
              className={`${styles.tabItem}${activeTab === key ? ` ${styles.tabItemActive}` : ''}`}
              onClick={() => setActiveTab(key)}
              role="option"
              aria-selected={activeTab === key}
            >
              {label}
            </div>
          ))}
        </div>
        <div className={styles.tabPanel}>
          {renderPanel()}
        </div>
      </div>

      <BrushStrokePreview
        size={brushSize}
        hardness={brushHardness}
        spacing={brushSpacing}
        opacity={brushOpacity}
        scatter={brushScatter}
        angle={brushAngle}
        tip={activeBrushTip}
        sizeJitter={sizeJitter}
        hardnessJitter={hardnessJitter}
        angleJitter={angleJitter}
        opacityJitter={opacityJitter}
        speedSize={speedSize}
        speedSizeInvert={speedSizeInvert}
        taper={brushTaper}
        texture={textureData}
        textureBlendMode={textureBlendMode}
        textureScale={textureScale}
      />
      <div className={styles.footer}>
        <div className={styles.footerLeft}>
          <button className={styles.smallButton} onClick={handleImportClick}>Import ABR</button>
          <button className={styles.smallButton} onClick={handleImportPresets}>Import</button>
          <button className={styles.smallButton} onClick={handleExportPresets}>Export</button>
        </div>
        <div className={styles.footerRight}>
          <button className={styles.smallButton} onClick={handleSavePreset}>Save Current</button>
          <button className={styles.smallButton} onClick={handleDelete} disabled={!isActiveCustom}>Delete</button>
        </div>
      </div>
    </div>
  );
}
