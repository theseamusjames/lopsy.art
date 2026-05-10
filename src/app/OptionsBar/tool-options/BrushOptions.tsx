import { useCallback } from 'react';
import { FlipHorizontal2, FlipVertical2, Snowflake } from 'lucide-react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { useUIStore } from '../../ui-store';
import { useEditorStore } from '../../editor-store';
import { Slider } from '../../../components/Slider/Slider';
import { IconButton } from '../../../components/IconButton/IconButton';
import { BrushThumbnail } from '../../../components/BrushModal/BrushThumbnail';
import { docScaledMax } from '../../../utils/slider-ranges';
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
  const radialSegments = useToolSettingsStore((s) => s.symmetryRadialSegments);
  const setRadialSegments = useToolSettingsStore((s) => s.setSymmetryRadialSegments);

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

  const isRadialActive = radialSegments >= 2;

  return (
    <>
      {activePreset && (
        <button className={styles.tipButton} onClick={handleOpenBrushModal} aria-label="Open brush presets" title="Open brush presets">
          <BrushThumbnail preset={activePreset} size={24} />
        </button>
      )}
      <Slider label="Size" value={brushSize} min={1} max={sizeMax} sliderMax={300} onChange={setBrushSize} />
      <Slider label="Opacity" value={brushOpacity} min={1} max={100} onChange={setBrushOpacity} />
      <Slider label="Hardness" value={brushHardness} min={0} max={100} onChange={setBrushHardness} />
      <Slider label="Fade" value={brushFade} min={0} max={fadeMax} onChange={setBrushFade} suffix="px" />
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
          icon={<Snowflake size={16} />}
          label="Radial Symmetry"
          isActive={isRadialActive}
          onClick={() => setRadialSegments(isRadialActive ? 0 : 8)}
        />
        {isRadialActive && (
          <>
            <label className={optionStyles.label} htmlFor="radial-segments">Segments</label>
            <input
              id="radial-segments"
              className={optionStyles.numberInput}
              type="number"
              min={2}
              max={32}
              value={radialSegments}
              onChange={(e) => setRadialSegments(Number(e.target.value))}
            />
          </>
        )}
      </div>
    </>
  );
}
