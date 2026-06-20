import { useState, useCallback } from 'react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { GradientModal } from '../../../components/GradientModal/GradientModal';
import { buildGradientCss } from '../../../components/GradientEditor/GradientEditor';
import type { GradientType } from '../../../tools/gradient/gradient';
import styles from '../OptionsBar.module.css';
import gradientStyles from './GradientOptions.module.css';

export function GradientOptions() {
  const gradientType = useToolSettingsStore((s) => s.settings.gradient.type);
  const gradientStops = useToolSettingsStore((s) => s.settings.gradient.stops);
  const gradientReverse = useToolSettingsStore((s) => s.settings.gradient.reverse);
  const setGradientSetting = useToolSettingsStore((s) => s.setGradientSetting);
  const [showModal, setShowModal] = useState(false);

  const handleOpenModal = useCallback(() => {
    setShowModal(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowModal(false);
  }, []);

  const sorted = [...gradientStops].sort((a, b) => a.position - b.position);

  return (
    <>
      <label className={styles.label} id="gradient-type-label">Type</label>
      <select
        className={styles.select}
        value={gradientType}
        onChange={(e) => setGradientSetting('type', e.target.value as GradientType)}
        aria-labelledby="gradient-type-label"
      >
        <option value="linear">Linear</option>
        <option value="radial">Radial</option>
      </select>

      <div className={styles.separator} />

      <button
        className={gradientStyles.swatch}
        style={{ '--gradient-css': buildGradientCss(sorted) } as React.CSSProperties}
        onClick={handleOpenModal}
        aria-label="Edit gradient stops"
        title="Edit gradient stops"
        data-testid="gradient-swatch"
      />

      <button
        className={gradientStyles.advancedBtn}
        onClick={handleOpenModal}
        data-testid="gradient-advanced-btn"
      >
        Advanced…
      </button>

      <div className={styles.separator} />

      <label className={styles.checkbox}>
        <input
          type="checkbox"
          checked={gradientReverse}
          onChange={(e) => setGradientSetting('reverse', e.target.checked)}
        />
        Reverse
      </label>

      {showModal && <GradientModal onClose={handleCloseModal} />}
    </>
  );
}
