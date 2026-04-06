import { useCallback } from 'react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { useBrushPresetStore } from '../../brush-preset-store';
import { Slider } from '../../../components/Slider/Slider';
import { BrushThumbnail } from '../../../components/BrushModal/BrushThumbnail';
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

  const presets = useBrushPresetStore((s) => s.presets);
  const activePresetId = useBrushPresetStore((s) => s.activePresetId);
  const activePreset = presets.find((p) => p.id === activePresetId) ?? presets[0];

  const handleOpenBrushModal = useCallback(() => {
    useBrushPresetStore.getState().setShowBrushModal(true);
  }, []);

  return (
    <>
      {activePreset && (
        <button className={styles.tipButton} onClick={handleOpenBrushModal} title="Open brush presets">
          <BrushThumbnail preset={activePreset} size={24} />
        </button>
      )}
      <Slider label="Size" value={brushSize} min={1} max={200} onChange={setBrushSize} />
      <Slider label="Opacity" value={brushOpacity} min={1} max={100} onChange={setBrushOpacity} />
      <Slider label="Hardness" value={brushHardness} min={0} max={100} onChange={setBrushHardness} />
      <Slider label="Fade" value={brushFade} min={0} max={2000} onChange={setBrushFade} suffix="px" />
    </>
  );
}
