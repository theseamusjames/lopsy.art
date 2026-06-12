import { FlipHorizontal2, FlipVertical2, Snowflake } from 'lucide-react';
import { useToolSettingsStore } from '../../app/tool-settings-store';
import { IconButton } from '../IconButton/IconButton';
import styles from './SymmetryControls.module.css';

interface SymmetryControlsProps {
  showRadial?: boolean;
}

export function SymmetryControls({ showRadial = false }: SymmetryControlsProps) {
  const symmetryH = useToolSettingsStore((s) => s.symmetryHorizontal);
  const symmetryV = useToolSettingsStore((s) => s.symmetryVertical);
  const setSymH = useToolSettingsStore((s) => s.setSymmetryHorizontal);
  const setSymV = useToolSettingsStore((s) => s.setSymmetryVertical);
  const radialSegments = useToolSettingsStore((s) => s.symmetryRadialSegments);
  const setRadialSegments = useToolSettingsStore((s) => s.setSymmetryRadialSegments);

  const isRadialActive = radialSegments >= 2;

  const mirrorToggles = (
    <>
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
    </>
  );

  if (!showRadial) return mirrorToggles;

  return (
    <div className={styles.symmetryGroup}>
      {mirrorToggles}
      <IconButton
        icon={<Snowflake size={16} />}
        label="Radial Symmetry"
        isActive={isRadialActive}
        onClick={() => setRadialSegments(isRadialActive ? 0 : 8)}
      />
      {isRadialActive && (
        <>
          <label className={styles.label} htmlFor="radial-segments">Segments</label>
          <input
            id="radial-segments"
            className={styles.numberInput}
            type="number"
            min={2}
            max={32}
            value={radialSegments}
            onChange={(e) => setRadialSegments(Number(e.target.value))}
          />
        </>
      )}
    </div>
  );
}
