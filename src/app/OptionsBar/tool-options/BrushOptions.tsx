import { useCallback } from 'react';
import { FlipHorizontal2, FlipVertical2 } from 'lucide-react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { useUIStore } from '../../ui-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { IconButton } from '../../../components/IconButton/IconButton';
import { BrushThumbnail } from '../../../components/BrushModal/BrushThumbnail';
import { docScaledMax } from '../../../utils/slider-ranges';
import type { BrushTextureBlendMode } from '../../../types/brush';
import optionStyles from '../OptionsBar.module.css';
import styles from './BrushOptions.module.css';

export function BrushOptions() {
  const brushSize = useToolSettingsStore((s) => s.brushSize);
  const brushOpacity = useToolSettingsStore((s) => s.brushOpacity);
  const brushHardness = useToolSettingsStore((s) => s.brushHardness);
  const setBrushSize = useToolSettingsStore((s) => s.setBrushSize);
  const setBrushOpacity = useToolSettingsStore((s) => s.setBrushOpacity);
  const setBrushHardness = useToolSettingsStore((s) => s.setBrushHardness);
  const brushFade = useToolSettingsStore((s) => s.brushFade);
  const setBrushFade = useToolSettingsStore((s) => s.setBrushFade);
  const symmetryH = useToolSettingsStore((s) => s.symmetryHorizontal);
  const symmetryV = useToolSettingsStore((s) => s.symmetryVertical);
  const setSymH = useToolSettingsStore((s) => s.setSymmetryHorizontal);
  const setSymV = useToolSettingsStore((s) => s.setSymmetryVertical);

  const sizeJitter = useToolSettingsStore((s) => s.brushSizeJitter);
  const angleJitter = useToolSettingsStore((s) => s.brushAngleJitter);
  const opacityJitter = useToolSettingsStore((s) => s.brushOpacityJitter);
  const setSizeJitter = useToolSettingsStore((s) => s.setBrushSizeJitter);
  const setAngleJitter = useToolSettingsStore((s) => s.setBrushAngleJitter);
  const setOpacityJitter = useToolSettingsStore((s) => s.setBrushOpacityJitter);

  const textureData = useToolSettingsStore((s) => s.brushTextureData);
  const textureBlendMode = useToolSettingsStore((s) => s.brushTextureBlendMode);
  const textureScale = useToolSettingsStore((s) => s.brushTextureScale);
  const textures = useToolSettingsStore((s) => s.brushTextures);
  const setTextureData = useToolSettingsStore((s) => s.setBrushTextureData);
  const setTextureBlendMode = useToolSettingsStore((s) => s.setBrushTextureBlendMode);
  const setTextureScale = useToolSettingsStore((s) => s.setBrushTextureScale);

  const presets = useToolSettingsStore((s) => s.presets);
  const activePresetId = useToolSettingsStore((s) => s.activePresetId);
  const activePreset = presets.find((p) => p.id === activePresetId) ?? presets[0];
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);
  const sizeMax = docScaledMax(docWidth, docHeight, 200);
  const fadeMax = docScaledMax(docWidth, docHeight, 2000);

  const handleOpenBrushModal = useCallback(() => {
    useUIStore.getState().setShowBrushModal(true);
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

  return (
    <>
      {activePreset && (
        <button className={styles.tipButton} onClick={handleOpenBrushModal} aria-label="Open brush presets" title="Open brush presets">
          <BrushThumbnail preset={activePreset} size={24} />
        </button>
      )}
      <Slider label="Size" value={brushSize} min={1} max={sizeMax} onChange={setBrushSize} />
      <Slider label="Opacity" value={brushOpacity} min={1} max={100} onChange={setBrushOpacity} />
      <Slider label="Hardness" value={brushHardness} min={0} max={100} onChange={setBrushHardness} />
      <Slider label="Fade" value={brushFade} min={0} max={fadeMax} onChange={setBrushFade} suffix="px" />

      <div className={styles.separator} />

      <Slider label="Size Jitter" value={sizeJitter} min={0} max={100} onChange={setSizeJitter} />
      <Slider label="Angle Jitter" value={angleJitter} min={0} max={100} onChange={setAngleJitter} />
      <Slider label="Opacity Jitter" value={opacityJitter} min={0} max={100} onChange={setOpacityJitter} />

      <div className={styles.separator} />

      <div className={styles.textureGroup}>
        <select
          className={optionStyles.select}
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
              className={optionStyles.select}
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

      <div className={styles.symmetryGroup}>
        <IconButton
          icon={<FlipVertical2 size={16} />}
          label="Symmetry Horizontal"
          isActive={symmetryH}
          onClick={() => setSymH(!symmetryH)}
        />
        <IconButton
          icon={<FlipHorizontal2 size={16} />}
          label="Symmetry Vertical"
          isActive={symmetryV}
          onClick={() => setSymV(!symmetryV)}
        />
      </div>
    </>
  );
}
