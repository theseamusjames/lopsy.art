import { useEffect } from 'react';
import { Images } from 'lucide-react';
import { Button } from '../Button/Button';
import type { PhotosSaveStatus } from '../../io/photos-handoff/photos-handoff-store';
import styles from './PhotosHandoffBar.module.css';

interface PhotosHandoffBarProps {
  /** The name Photos gave the document. */
  name: string;
  status: PhotosSaveStatus;
  onSave: () => void;
  onBack: () => void;
}

function statusText(status: PhotosSaveStatus): string | null {
  switch (status.kind) {
    case 'idle':
      return null;
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved to Photonamous';
    case 'failed':
      return `Couldn't save: ${status.reason}`;
  }
}

/**
 * Shown while the document came from Photonamous. While it is up, ⌘S /
 * Ctrl+S saves to Photos instead of the browser's Save Page.
 */
export function PhotosHandoffBar({ name, status, onSave, onBack }: PhotosHandoffBarProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key !== 's' && e.key !== 'S') return;
      e.preventDefault();
      e.stopPropagation();
      onSave();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onSave]);

  const text = statusText(status);
  const isSaving = status.kind === 'saving';

  return (
    <div className={styles.bar} role="region" aria-label="Photonamous">
      <Images className={styles.icon} size={14} aria-hidden="true" />
      <span className={styles.title}>
        From Photonamous: <span className={styles.name}>{name}</span>
      </span>
      {text && (
        <span
          className={[styles.status, status.kind === 'failed' ? styles.failed : '', status.kind === 'saved' ? styles.saved : '']
            .filter(Boolean)
            .join(' ')}
          role="status"
        >
          {text}
        </span>
      )}
      <div className={styles.actions}>
        <Button variant="primary" onClick={onSave} disabled={isSaving}>
          Save to Photonamous
        </Button>
        <Button variant="secondary" onClick={onBack}>
          Back to Photonamous
        </Button>
      </div>
    </div>
  );
}
