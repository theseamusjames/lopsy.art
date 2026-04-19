import { useState, useCallback } from 'react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { GradientModal } from '../../../components/GradientModal/GradientModal';
import { buildGradientCss } from '../../../components/GradientEditor/GradientEditor';
import type { GradientType } from '../../../tools/gradient/gradient';
import styles from '../OptionsBar.module.css';
import gradientStyles from './GradientOptions.module.css';

export function GradientOptions() {
  const gradientType = useToolSettingsStore((s) => s.gradientType);
  const setGradientType = useToolSettingsStore((s) => s.setGradientType);
  const gradientStops = useToolSettingsStore((s) => s.gradientStops);
  const gradientReverse = useToolSettingsStore((s) => s.gradientReverse);
  const setGradientReverse = useToolSettingsStore((s) => s.setGradientReverse);
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
        onChange={(e) => setGradientType(e.target.value as GradientType)}
        aria-labelledby="gradient-type-label"
      >
        <option value="linear">Linear</option>
        <option value="radial">Radial</option>
      </select>

      <div className={styles.separator} />

      <button
        className={gradientStyles.swatch}
        style={{ background: buildGradientCss(sorted) }}
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
          onChange={(e) => setGradientReverse(e.target.checked)}
        />
        Reverse
      </label>

      {showModal && <GradientModal onClose={handleCloseModal} />}
    </>
  );
}
