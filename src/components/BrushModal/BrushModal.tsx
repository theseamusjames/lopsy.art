import { useCallback, useRef, useState } from 'react';
import { useDraggablePanel } from '../../app/hooks/useDraggablePanel';
import { useToolSettingsStore, abrBrushToPreset } from '../../app/tool-settings-store';
import { useUIStore } from '../../app/ui-store';
import { useEditorStore } from '../../app/editor-store';
import { Slider } from '../Slider/Slider';
import { AngleControl } from './AngleControl';
import { BrushDabPreview } from './BrushDabPreview';
import { BrushThumbnail } from './BrushThumbnail';
import type { BrushTipData, BrushTextureBlendMode } from '../../types/brush';
import { describeError, notifyError } from '../../app/notifications-store';
import { importPresetsFromFile } from '../../tools/brush/preset-io';
import { docScaledMax } from '../../utils/slider-ranges';
import { BrushStrokePreview } from './BrushStrokePreview';
import { BrushExportModal } from './BrushExportModal';
import styles from './BrushModal.module.css';

type TabKey = 'shape' | 'dynamics' | 'texture' | 'presets' | 'sub-brushes';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'presets', label: 'Presets' },
  { key: 'shape', label: 'Shape' },
  { key: 'dynamics', label: 'Dynamics' },
  { key: 'texture', label: 'Texture' },
  { key: 'sub-brushes', label: 'Sub-Brushes' },
];

let nextTextureId = 1;

export function BrushModal() {
  const textureFileInputRef = useRef<HTMLInputElement>(null);
  const [textureImporting, setTextureImporting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('presets');
  const [showExportModal, setShowExportModal] = useState(false);
  const { offset: dragOffset, dragProps: titleDragProps } = useDraggablePanel();

  const presets = useToolSettingsStore((s) => s.presets);
  const activePresetId = useToolSettingsStore((s) => s.activePresetId);
  const setActivePreset = useToolSettingsStore((s) => s.setActivePreset);
  const setTipFromPreset = useToolSettingsStore((s) => s.setTipFromPreset);
  const removePreset = useToolSettingsStore((s) => s.removePreset);
  const addPresets = useToolSettingsStore((s) => s.addPresets);
  const saveCurrentAsPreset = useToolSettingsStore((s) => s.saveCurrentAsPreset);
  const setShowBrushModal = useUIStore((s) => s.setShowBrushModal);

  const brushSize = useToolSettingsStore((s) => s.settings.brush.size);
  const brushOpacity = useToolSettingsStore((s) => s.settings.brush.opacity);
  const brushHardness = useToolSettingsStore((s) => s.settings.brush.hardness);
  const brushSpacing = useToolSettingsStore((s) => s.settings.brush.spacing);
  const brushScatter = useToolSettingsStore((s) => s.settings.brush.scatter);
  const brushAngle = useToolSettingsStore((s) => s.settings.brush.angle);
  const brushTaper = useToolSettingsStore((s) => s.settings.brush.taper);
  const activeBrushTip = useToolSettingsStore((s) => s.activeBrushTip);

  const setBrushSetting = useToolSettingsStore((s) => s.setBrushSetting);
  const setBrushSize = useCallback((v: number) => setBrushSetting('size', v), [setBrushSetting]);
  const setBrushOpacity = useCallback((v: number) => setBrushSetting('opacity', v), [setBrushSetting]);
  const setBrushHardness = useCallback((v: number) => setBrushSetting('hardness', v), [setBrushSetting]);
  const setBrushSpacing = useCallback((v: number) => setBrushSetting('spacing', v), [setBrushSetting]);
  const setBrushScatter = useCallback((v: number) => setBrushSetting('scatter', v), [setBrushSetting]);
  const setBrushAngle = useCallback((v: number) => setBrushSetting('angle', v), [setBrushSetting]);
  const setBrushTaper = useCallback((v: number) => setBrushSetting('taper', v), [setBrushSetting]);

  const sizeJitter = useToolSettingsStore((s) => s.settings.brushJitter.size);
  const hardnessJitter = useToolSettingsStore((s) => s.settings.brushJitter.hardness);
  const angleJitter = useToolSettingsStore((s) => s.settings.brushJitter.angle);
  const opacityJitter = useToolSettingsStore((s) => s.settings.brushJitter.opacity);
  const speedSize = useToolSettingsStore((s) => s.settings.brushSpeed.size);
  const speedSizeInvert = useToolSettingsStore((s) => s.settings.brushSpeed.sizeInvert);
  const speedSensitivity = useToolSettingsStore((s) => s.settings.brushSpeed.sensitivity);
  const setBrushJitterSetting = useToolSettingsStore((s) => s.setBrushJitterSetting);
  const setSizeJitter = (v: number) => setBrushJitterSetting('size', v);
  const setHardnessJitter = (v: number) => setBrushJitterSetting('hardness', v);
  const setAngleJitter = (v: number) => setBrushJitterSetting('angle', v);
  const setOpacityJitter = (v: number) => setBrushJitterSetting('opacity', v);
  const setBrushSpeedSetting = useToolSettingsStore((s) => s.setBrushSpeedSetting);

  const textureData = useToolSettingsStore((s) => s.settings.brushTexture.data);
  const textureBlendMode = useToolSettingsStore((s) => s.settings.brushTexture.blendMode);
  const textureScale = useToolSettingsStore((s) => s.settings.brushTexture.scale);
  const textures = useToolSettingsStore((s) => s.brushTextures);
  const setBrushTextureSetting = useToolSettingsStore((s) => s.setBrushTextureSetting);
  const addBrushTexture = useToolSettingsStore((s) => s.addBrushTexture);
  const removeBrushTexture = useToolSettingsStore((s) => s.removeBrushTexture);

  const activeSubBrushes = useToolSettingsStore((s) => s.activeSubBrushes);
  const addSubBrush = useToolSettingsStore((s) => s.addSubBrush);
  const removeSubBrush = useToolSettingsStore((s) => s.removeSubBrush);
  const updateSubBrush = useToolSettingsStore((s) => s.updateSubBrush);

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
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.abr,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(reader.result as string) as { presets: unknown[] };
            if (Array.isArray(parsed.presets)) {
              importPresetsFromFile(file, (p) => useToolSettingsStore.getState().addPresets(p));
            }
          } catch { /* not valid JSON, ignore */ }
        };
        reader.readAsText(file);
      } else {
        handleAbrFile(file);
      }
    };
    input.click();
  }, []);

  const handleAbrFile = useCallback((file: File) => {
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



  const handleTextureChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (id === 'none') {
      setBrushTextureSetting('data', null);
    } else {
      const tex = textures.find((t) => t.id === id);
      if (tex) setBrushTextureSetting('data', tex);
    }
  }, [textures, setBrushTextureSetting]);

  const handleBlendModeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setBrushTextureSetting('blendMode', e.target.value as BrushTextureBlendMode);
  }, [setBrushTextureSetting]);

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
      setBrushTextureSetting('data', tex);
      URL.revokeObjectURL(url);
      setTextureImporting(false);
    };
    img.onerror = () => { notifyError('Failed to load texture image.'); URL.revokeObjectURL(url); setTextureImporting(false); };
    img.src = url;
    if (textureFileInputRef.current) textureFileInputRef.current.value = '';
  }, [addBrushTexture, setBrushTextureSetting]);

  const handleTextureDelete = useCallback(() => {
    if (textureData && textureData.id.startsWith('texture-custom-')) removeBrushTexture(textureData.id);
  }, [textureData, removeBrushTexture]);

  const isCustomTexture = textureData !== null && textureData.id.startsWith('texture-custom-');

  function renderPanel() {
    switch (activeTab) {
      case 'presets':
        return (
          <>
            <div className={styles.galleryFull}>
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
            <div className={styles.presetActions}>
              <button className={styles.smallButton} onClick={handleImportClick}>Import</button>
              <button className={styles.smallButton} onClick={handleDelete} disabled={!isActiveCustom}>Delete</button>
            </div>
          </>
        );
      case 'shape':
        return (
          <>
            <div className={styles.galleryStage}>
              <div className={styles.galleryGrid}>
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    className={`${styles.presetItem}${(preset.tip !== null && activeBrushTip === preset.tip) || (preset.tip === null && activeBrushTip === null && preset.id === activePresetId) ? ` ${styles.presetItemActive}` : ''}`}
                    onClick={() => setTipFromPreset(preset.id)}
                    aria-label={`Brush shape: ${preset.name}`}
                    title={preset.name}
                  >
                    <BrushThumbnail preset={preset} size={36} />
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.sliderSection}>
              {/* #664 — pin drag ranges to a usable interval; text input
                  still accepts up to the document-scaled max. */}
              <Slider label="Size" value={brushSize} min={1} max={sizeMax} sliderMax={300} onChange={setBrushSize} />
              <Slider label="Spacing" value={brushSpacing} min={1} max={200} onChange={setBrushSpacing} />
              <Slider label="Hardness" value={brushHardness} min={0} max={100} onChange={setBrushHardness} />
              <Slider label="Opacity" value={brushOpacity} min={1} max={100} onChange={setBrushOpacity} />
              <Slider label="Taper" value={brushTaper} min={0} max={taperMax} sliderMax={1000} onChange={setBrushTaper} suffix="px" />
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
            <Slider label="Scatter" value={brushScatter} min={0} max={100} onChange={setBrushScatter} />
            <Slider label="Size Jitter" value={sizeJitter} min={0} max={100} onChange={setSizeJitter} />
            <Slider label="Hardness Jitter" value={hardnessJitter} min={0} max={100} onChange={setHardnessJitter} />
            <Slider label="Angle Jitter" value={angleJitter} min={0} max={100} onChange={setAngleJitter} />
            <Slider label="Opacity Jitter" value={opacityJitter} min={0} max={100} onChange={setOpacityJitter} />
            <Slider label="Speed Size" value={speedSize} min={0} max={speedSizeInvert ? 300 : 100} onChange={(v) => setBrushSpeedSetting('size', v)} />
            <div className={styles.speedToggleRow}>
              <span className={styles.speedToggleLabel}>Faster is</span>
              <div className={styles.speedToggleGroup}>
                <button
                  className={`${styles.speedToggle}${!speedSizeInvert ? ` ${styles.speedToggleActive}` : ''}`}
                  onClick={() => { setBrushSpeedSetting('sizeInvert', false); if (speedSize > 100) setBrushSpeedSetting('size', 100); }}
                >
                  Thinner
                </button>
                <button
                  className={`${styles.speedToggle}${speedSizeInvert ? ` ${styles.speedToggleActive}` : ''}`}
                  onClick={() => setBrushSpeedSetting('sizeInvert', true)}
                >
                  Wider
                </button>
              </div>
              <span className={styles.speedToggleLabel}>Sensitivity</span>
              <div className={styles.speedToggleGroup}>
                <button
                  className={`${styles.speedToggle}${speedSensitivity === 'low' ? ` ${styles.speedToggleActive}` : ''}`}
                  onClick={() => setBrushSpeedSetting('sensitivity', 'low')}
                >
                  Low
                </button>
                <button
                  className={`${styles.speedToggle}${speedSensitivity === 'med' ? ` ${styles.speedToggleActive}` : ''}`}
                  onClick={() => setBrushSpeedSetting('sensitivity', 'med')}
                >
                  Med
                </button>
                <button
                  className={`${styles.speedToggle}${speedSensitivity === 'high' ? ` ${styles.speedToggleActive}` : ''}`}
                  onClick={() => setBrushSpeedSetting('sensitivity', 'high')}
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
                <Slider label="Scale" value={textureScale} min={10} max={300} onChange={(v) => setBrushTextureSetting('scale', v)} />
              </>
            )}
          </div>
        );
      case 'sub-brushes':
        return (
          <div className={styles.sliderSection}>
            {activeSubBrushes.map((sub, idx) => (
              <div key={idx} className={styles.textureSection}>
                <div className={styles.textureRow}>
                  <span className={styles.speedToggleLabel}>Sub-Brush {idx + 1}</span>
                  <button className={styles.smallButton} onClick={() => removeSubBrush(idx)}>Remove</button>
                </div>
                <div className={styles.galleryStage}>
                  <div className={styles.galleryGrid}>
                    {presets.map((preset) => (
                      <button
                        key={preset.id}
                        className={`${styles.presetItem}${sub.tipPresetId === preset.id ? ` ${styles.presetItemActive}` : ''}`}
                        onClick={() => updateSubBrush(idx, { tip: preset.tip, tipPresetId: preset.id })}
                        aria-label={`Sub-brush tip: ${preset.name}`}
                        title={preset.name}
                      >
                        <BrushThumbnail preset={preset} size={28} />
                      </button>
                    ))}
                  </div>
                </div>
                <Slider label="Size Ratio" value={Math.round(sub.sizeRatio * 100)} min={10} max={200} onChange={(v) => updateSubBrush(idx, { sizeRatio: v / 100 })} />
                <Slider label="Hardness" value={sub.hardness} min={0} max={100} onChange={(v) => updateSubBrush(idx, { hardness: v })} />
                <Slider label="Opacity Ratio" value={Math.round(sub.opacityRatio * 100)} min={1} max={100} onChange={(v) => updateSubBrush(idx, { opacityRatio: v / 100 })} />
                <Slider label="Angle Offset" value={sub.angleOffset} min={0} max={360} onChange={(v) => updateSubBrush(idx, { angleOffset: v })} />
                <Slider label="Size Jitter" value={sub.sizeJitter} min={0} max={100} onChange={(v) => updateSubBrush(idx, { sizeJitter: v })} />
                <Slider label="Angle Jitter" value={sub.angleJitter} min={0} max={100} onChange={(v) => updateSubBrush(idx, { angleJitter: v })} />
                <Slider label="Opacity Jitter" value={sub.opacityJitter} min={0} max={100} onChange={(v) => updateSubBrush(idx, { opacityJitter: v })} />
              </div>
            ))}
            <button
              className={styles.smallButton}
              onClick={() => addSubBrush({
                tip: null,
                sizeRatio: 0.5,
                hardness: 100,
                opacityRatio: 0.5,
                angleOffset: 0,
                sizeJitter: 0,
                angleJitter: 0,
                opacityJitter: 0,
              })}
            >
              Add Sub-Brush
            </button>
          </div>
        );
    }
  }

  return (
    <div
      className={styles.panel}
      role="dialog"
      aria-label="Brushes"
      style={{ '--drag-x': `${dragOffset.x}px`, '--drag-y': `${dragOffset.y}px` } as React.CSSProperties}
    >
      <div className={styles.titleBar} {...titleDragProps}>
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
        <button className={styles.smallButton} onClick={() => setShowExportModal(true)}>Export</button>
        <button className={styles.smallButton} onClick={handleSavePreset}>Save Current</button>
      </div>
      {showExportModal && <BrushExportModal onClose={() => setShowExportModal(false)} />}
    </div>
  );
}
