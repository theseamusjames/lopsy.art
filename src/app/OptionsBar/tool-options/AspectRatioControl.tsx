import { Lock, Unlock } from 'lucide-react';
import { useToolSettingsStore } from '../../tool-settings-store';
import styles from '../OptionsBar.module.css';

export function AspectRatioControl() {
  const aspectRatioW = useToolSettingsStore((s) => s.aspectRatioW);
  const aspectRatioH = useToolSettingsStore((s) => s.aspectRatioH);
  const aspectRatioLocked = useToolSettingsStore((s) => s.aspectRatioLocked);
  const setAspectRatioW = useToolSettingsStore((s) => s.setAspectRatioW);
  const setAspectRatioH = useToolSettingsStore((s) => s.setAspectRatioH);
  const setAspectRatioLocked = useToolSettingsStore((s) => s.setAspectRatioLocked);

  return (
    <>
      <span className={styles.label}>Ratio</span>
      <div className={styles.ratioGroup}>
        <input
          className={styles.ratioInput}
          type="number"
          min={1}
          step={1}
          value={aspectRatioW}
          onChange={(e) => setAspectRatioW(Number(e.target.value))}
        />
        <span className={styles.ratioSeparator}>:</span>
        <input
          className={styles.ratioInput}
          type="number"
          min={1}
          step={1}
          value={aspectRatioH}
          onChange={(e) => setAspectRatioH(Number(e.target.value))}
        />
        <button
          className={`${styles.lockBtn} ${aspectRatioLocked ? styles.lockBtnActive : ''}`}
          type="button"
          onClick={() => setAspectRatioLocked(!aspectRatioLocked)}
          title={aspectRatioLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
        >
          {aspectRatioLocked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
      </div>
    </>
  );
}
