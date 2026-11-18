import { useEffect, useMemo, useState } from 'react';
import type { VersionId } from '@lopsy/photos-core/library/types';
import { getBackend } from '../../app/backend-registry';
import type { ExportFormat } from '../../app/backend';
import { useExportProgress, useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { currentVersions } from '../../app/commands';
import { plural } from '../../import/import-summary';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import styles from './ExportDialog.module.css';

const SIZES: ReadonlyArray<{ readonly value: number | null; readonly label: string }> = [
  { value: null, label: 'Full size' },
  { value: 3840, label: 'Large — 3840 px on the long side' },
  { value: 2048, label: 'For the web — 2048 px' },
  { value: 1080, label: 'Small — 1080 px' },
];

function defaultName(): string {
  const d = new Date();
  return `Export ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Saves edited copies of the selected photos as JPEG or PNG. */
export function ExportDialog() {
  const session = useSession();
  const openDialog = useUi((s) => s.openDialog);
  const job = useUi((s) => s.exportJob);
  const setExportJob = useUi((s) => s.setExportJob);
  const progress = useExportProgress(job);
  const [versionIds] = useState<VersionId[]>(() =>
    currentVersions().map((v) => v.versionId),
  );
  const [format, setFormat] = useState<ExportFormat>('jpeg');
  const [quality, setQuality] = useState(90);
  const [longEdge, setLongEdge] = useState<number | null>(null);
  const [destination, setDestination] = useState<'library' | 'download'>('library');
  const [name, setName] = useState(defaultName);
  const running = progress !== null && !progress.finished;

  // A finished export from before is not this one; start clean. A running one stays shown.
  useEffect(() => {
    const previous = useUi.getState().exportJob;
    if (previous && previous.getProgress().finished) setExportJob(null);
  }, [setExportJob]);
  const where = useMemo(() => (session.adapter.kind === 'google-drive' ? 'Google Drive' : 'your library'), [session]);

  const close = () => openDialog(null);
  const start = () => {
    setExportJob(
      getBackend().exportVersions(session, {
        versionIds,
        format,
        quality,
        longEdge,
        destination,
        name: name.trim() || defaultName(),
      }),
    );
  };

  return (
    <Modal
      title={`Export ${plural(versionIds.length, 'photo')}`}
      onClose={close}
      footer={
        progress?.finished ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close}>{running ? 'Keep going in the background' : 'Cancel'}</Button>
            <Button variant="primary" disabled={running || versionIds.length === 0} onClick={start}>
              Export
            </Button>
          </>
        )
      }
    >
      <div className={styles.form}>
        <fieldset className={styles.group} disabled={running}>
          <legend className={styles.legend}>File type</legend>
          <label className={styles.option}>
            <input type="radio" name="format" checked={format === 'jpeg'} onChange={() => setFormat('jpeg')} />
            JPEG <span className={styles.muted}>— small files, for sharing</span>
          </label>
          <label className={styles.option}>
            <input type="radio" name="format" checked={format === 'png'} onChange={() => setFormat('png')} />
            PNG <span className={styles.muted}>— no compression loss, larger files</span>
          </label>
          {format === 'jpeg' && (
            <label className={styles.range}>
              <span>Quality</span>
              <input type="range" min={40} max={100} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
              <span className={styles.value}>{quality}</span>
            </label>
          )}
        </fieldset>

        <label className={styles.field}>
          <span className={styles.legend}>Size</span>
          <select
            className={styles.select}
            disabled={running}
            value={longEdge ?? ''}
            onChange={(e) => setLongEdge(e.target.value === '' ? null : Number(e.target.value))}
          >
            {SIZES.map((s) => (
              <option key={s.label} value={s.value ?? ''}>
                {s.label}
              </option>
            ))}
          </select>
          <span className={styles.muted}>Photos are never made larger than they are.</span>
        </label>

        <fieldset className={styles.group} disabled={running}>
          <legend className={styles.legend}>Save to</legend>
          <label className={styles.option}>
            <input type="radio" name="dest" checked={destination === 'library'} onChange={() => setDestination('library')} />
            The Exports folder in {where}
          </label>
          {destination === 'library' && (
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Folder name"
              placeholder="Folder name"
            />
          )}
          <label className={styles.option}>
            <input type="radio" name="dest" checked={destination === 'download'} onChange={() => setDestination('download')} />
            Download to this computer
          </label>
        </fieldset>

        {progress && (
          <div className={styles.progress} aria-live="polite">
            <div className={styles.bar}>
              <span
                className={styles.fill}
                style={{ '--fraction': `${progress.total === 0 ? 100 : (progress.done / progress.total) * 100}%` } as React.CSSProperties}
              />
            </div>
            <p className={styles.muted}>
              {progress.finished
                ? `Exported ${plural(progress.done - progress.failures.length, 'photo')}.`
                : `Exporting ${progress.done} of ${progress.total}…`}
              {progress.failures.length > 0 && ` ${progress.failures.length} failed.`}
            </p>
            {progress.failures.length > 0 && (
              <ul className={styles.failures} role="alert">
                {[...new Set(progress.failures.map((f) => f.error))].slice(0, 3).map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
