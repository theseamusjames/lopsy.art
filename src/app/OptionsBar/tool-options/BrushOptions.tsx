import { useCallback } from 'react';
import { FlipHorizontal2, FlipVertical2, Flower2 } from 'lucide-react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { useUIStore } from '../../ui-store';
import { Slider } from '../../../components/Slider/Slider';
import { IconButton } from '../../../components/IconButton/IconButton';
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
  const symmetryH = useToolSettingsStore((s) => s.symmetryHorizontal);
  const symmetryV = useToolSettingsStore((s) => s.symmetryVertical);
  const setSymH = useToolSettingsStore((s) => s.setSymmetryHorizontal);
  const setSymV = useToolSettingsStore((s) => s.setSymmetryVertical);
  const symmetryRadial = useToolSettingsStore((s) => s.symmetryRadial);
  const symmetrySegments = useToolSettingsStore((s) => s.symmetrySegments);
  const setSymRadial = useToolSettingsStore((s) => s.setSymmetryRadial);
  const setSymSegments = useToolSettingsStore((s) => s.setSymmetrySegments);

  const presets = useToolSettingsStore((s) => s.presets);
  const activePresetId = useToolSettingsStore((s) => s.activePresetId);
  const activePreset = presets.find((p) => p.id === activePresetId) ?? presets[0];

  const handleOpenBrushModal = useCallback(() => {
    useUIStore.getState().setShowBrushModal(true);
  }, []);

  return (
    <>
      {activePreset && (
        <button className={styles.tipButton} onClick={handleOpenBrushModal} aria-label="Open brush presets" title="Open brush presets">
          <BrushThumbnail preset={activePreset} size={24} />
        </button>
      )}
      <Slider label="Size" value={brushSize} min={1} max={200} onChange={setBrushSize} />
      <Slider label="Opacity" value={brushOpacity} min={1} max={100} onChange={setBrushOpacity} />
      <Slider label="Hardness" value={brushHardness} min={0} max={100} onChange={setBrushHardness} />
      <Slider label="Fade" value={brushFade} min={0} max={2000} onChange={setBrushFade} suffix="px" />
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
        <IconButton
          icon={<Flower2 size={16} />}
          label="Radial Symmetry (Mandala)"
          isActive={symmetryRadial}
          onClick={() => setSymRadial(!symmetryRadial)}
        />
        {symmetryRadial && (
          <Slider label="Segments" value={symmetrySegments} min={2} max={32} onChange={setSymSegments} />
        )}
      </div>
    </>
  );
}
