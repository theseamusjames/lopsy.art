import type { CSSProperties } from 'react';
import type { LoadProgress } from '../../engine/develop-engine';
import type { EngineStatus } from '../EditView/use-photo-engine';
import styles from './LoadStatus.module.css';

export interface LoadStatusProps {
  readonly status: EngineStatus;
  readonly onClose: () => void;
  /** The error's way out; 'Back to the library' by default. */
  readonly closeLabel?: string;
}

function progressText(progress: LoadProgress | null): string {
  if (!progress || progress.stage === 'reading') return 'Reading the original';
  if (progress.stage === 'uploading') return 'Preparing the photo';
  return 'Developing the photo';
}

/** Covers the image while the engine starts and the photo loads, or when either failed. */
export function LoadStatus({ status, onClose, closeLabel = 'Back to the library' }: LoadStatusProps) {
  if (status.kind === 'ready') return null;
  if (status.kind === 'error') {
    return (
      <div className={styles.overlay} role="alert">
        <p className={styles.title}>This photo could not be opened</p>
        <p className={styles.detail}>{status.message}</p>
        <button type="button" className={styles.button} onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    );
  }
  const progress = status.kind === 'loading' ? status.progress : null;
  const fraction = progress?.fraction ?? null;
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <p className={styles.title}>{status.kind === 'starting' ? 'Starting the editor' : progressText(progress)}</p>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Loading"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={fraction === null ? undefined : Math.round(fraction * 100)}
        data-indeterminate={fraction === null || undefined}
        style={{ '--progress': `${Math.round((fraction ?? 0) * 100)}%` } as CSSProperties}
      >
        <div className={styles.fill} />
      </div>
    </div>
  );
}
