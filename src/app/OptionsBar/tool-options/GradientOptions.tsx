import { useState, useCallback } from 'react';
import { useToolSettingsStore } from '../../tool-settings-store';
import { GradientModal } from '../../../components/GradientModal/GradientModal';
import { buildGradientCss } from '../../../components/GradientEditor/GradientEditor';
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
      <span className={styles.label}>Type</span>
      <select
        className={styles.select}
        value={gradientType}
        onChange={(e) => setGradientType(e.target.value as 'linear' | 'radial')}
      >
        <option value="linear">Linear</option>
        <option value="radial">Radial</option>
      </select>

      <div className={styles.separator} />

      <button
        className={gradientStyles.swatch}
        style={{ background: buildGradientCss(sorted) }}
        onClick={handleOpenModal}
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
