import { FlipHorizontal2, FlipVertical2, Snowflake } from 'lucide-react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { Slider } from '../../../components/Slider/Slider';
import { IconButton } from '../../../components/IconButton/IconButton';
import styles from './BrushOptions.module.css';

export function PencilOptions() {
  const pencilSize = useToolSettingsStore((s) => s.pencilSize);
  const setPencilSize = useToolSettingsStore((s) => s.setPencilSize);
  const symmetryH = useToolSettingsStore((s) => s.symmetryHorizontal);
  const symmetryV = useToolSettingsStore((s) => s.symmetryVertical);
  const setSymH = useToolSettingsStore((s) => s.setSymmetryHorizontal);
  const setSymV = useToolSettingsStore((s) => s.setSymmetryVertical);
  const radialSegments = useToolSettingsStore((s) => s.symmetryRadialSegments);
  const setRadialSegments = useToolSettingsStore((s) => s.setSymmetryRadialSegments);

  const isRadialActive = radialSegments >= 2;

  return (
    <>
      <Slider label="Size" value={pencilSize} min={1} max={100} onChange={setPencilSize} />
      <div className={styles.symmetryGroup}>
        <IconButton
          icon={<FlipHorizontal2 size={16} />}
          label="Symmetry Horizontal"
          isActive={symmetryH}
          onClick={() => setSymH(!symmetryH)}
        />
        <IconButton
          icon={<FlipVertical2 size={16} />}
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
          <Slider label="Segments" value={radialSegments} min={2} max={32} onChange={setRadialSegments} />
        )}
      </div>
    </>
  );
}
