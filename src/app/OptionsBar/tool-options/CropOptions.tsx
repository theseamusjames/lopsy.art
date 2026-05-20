import { useToolSettingsStore } from '../../tool-settings-store';
import { useUIStore } from '../../ui-store';
import { commitPerspectiveCrop } from '../../../tools/crop/perspective-crop-interaction';
import { AspectRatioControl } from './AspectRatioControl';
import styles from '../OptionsBar.module.css';

export function CropOptions() {
  const cropMode = useToolSettingsStore((s) => s.cropMode);
  const setCropMode = useToolSettingsStore((s) => s.setCropMode);
  const perspectiveCropQuad = useUIStore((s) => s.perspectiveCropQuad);
  const setPerspectiveCropQuad = useUIStore((s) => s.setPerspectiveCropQuad);
  const setPerspectiveCropDragging = useUIStore((s) => s.setPerspectiveCropDragging);

  function handleModeChange(mode: 'normal' | 'perspective') {
    setCropMode(mode);
    // Clear any active overlay when switching modes
    setPerspectiveCropQuad(null);
    setPerspectiveCropDragging(null);
  }

  return (
    <>
      <span className={styles.label}>Mode</span>
      <select
        className={styles.select}
        aria-label="Crop mode"
        value={cropMode}
        onChange={(e) => handleModeChange(e.target.value as 'normal' | 'perspective')}
      >
        <option value="normal">Normal</option>
        <option value="perspective">Perspective</option>
      </select>
      <div className={styles.separator} />
      {cropMode === 'normal' ? (
        <>
          <span className={styles.hint}>Drag to select crop area</span>
          <div className={styles.separator} />
          <AspectRatioControl />
        </>
      ) : (
        <>
          <span className={styles.hint}>
            {perspectiveCropQuad ? 'Drag corners to adjust — then click Apply' : 'Click canvas to place perspective quad'}
          </span>
          {perspectiveCropQuad && (
            <>
              <div className={styles.separator} />
              <button
                className={styles.lockBtn}
                type="button"
                onClick={commitPerspectiveCrop}
                aria-label="Apply perspective crop"
              >
                Apply
              </button>
              <button
                className={styles.lockBtn}
                type="button"
                onClick={() => {
                  setPerspectiveCropQuad(null);
                  setPerspectiveCropDragging(null);
                }}
                aria-label="Cancel perspective crop"
              >
                Cancel
              </button>
            </>
          )}
        </>
      )}
    </>
  );
}
