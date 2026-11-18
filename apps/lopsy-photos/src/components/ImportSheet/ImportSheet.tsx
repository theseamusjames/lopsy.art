import { useEffect, useMemo, useState } from 'react';
import type { StorageQuota } from '@lopsy/photos-core/storage/types';
import { getBackend } from '../../app/backend-registry';
import { useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { formatBytes, isPhotoFile, plural, summarizeImport } from '../../import/import-summary';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import styles from './ImportSheet.module.css';

/** Before an import starts: what is about to come in, and the RAW+JPEG choice. */
export function ImportSheet() {
  const session = useSession();
  const files = useUi((s) => s.pendingImport);
  const setPendingImport = useUi((s) => s.setPendingImport);
  const busy = useUi((s) => s.importJob !== null && !s.importJob.getProgress().finished);
  const [pairs, setPairs] = useState<'both' | 'raw-only'>('both');
  const [quota, setQuota] = useState<StorageQuota | null>(null);

  const summary = useMemo(
    () => summarizeImport(files ?? [], (i) => files?.[i]?.webkitRelativePath ?? ''),
    [files],
  );

  useEffect(() => {
    let live = true;
    getBackend()
      .getQuota(session)
      .then((q) => {
        if (live) setQuota(q);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [session]);

  if (!files) return null;
  const close = () => setPendingImport(null);
  const bytes = pairs === 'raw-only' ? summary.totalBytes - summary.pairJpegBytes : summary.totalBytes;
  const free = quota && quota.limitBytes !== null ? Math.max(0, quota.limitBytes - quota.usedBytes) : null;
  const tooBig = free !== null && bytes > free;

  const start = () => {
    const photos = files.filter((f) => isPhotoFile(f.name));
    const job = getBackend().startImport(photos, session, { rawPlusJpeg: pairs, skipDuplicates: true });
    const ui = useUi.getState();
    ui.setImportJob(job);
    ui.setPendingImport(null);
    ui.setCollection({ kind: 'recent' });
  };

  return (
    <Modal
      title="Import photos"
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={summary.photoCount === 0 || busy} onClick={start} data-autofocus>
            Import {plural(summary.photoCount - (pairs === 'raw-only' ? summary.pairCount : 0), 'photo')}
          </Button>
        </>
      }
    >
      {summary.photoCount === 0 ? (
        <p>None of these files are photos this app can read (RAF, DNG, JPEG, PNG or WebP).</p>
      ) : (
        <div className={styles.body}>
          <p className={styles.big}>
            {plural(summary.photoCount, 'photo')}, {formatBytes(bytes)}
          </p>
          {free !== null && (
            <p className={tooBig ? styles.warn : styles.muted}>
              {tooBig
                ? `There is not enough room: ${formatBytes(free)} is free.`
                : `${formatBytes(free)} free in ${session.adapter.label}.`}
            </p>
          )}
          <p className={styles.muted}>Photos already in the library are skipped. The files you pick are never changed.</p>

          {summary.pairCount > 0 && (
            <fieldset className={styles.choice}>
              <legend className={styles.legend}>
                {plural(summary.pairCount, 'photo was', 'photos were')} saved as both RAW and JPEG
              </legend>
              <label className={styles.option}>
                <input type="radio" name="pairs" checked={pairs === 'both'} onChange={() => setPairs('both')} />
                <span>
                  Keep both <span className={styles.muted}>— shown as one photo, the RAW in front</span>
                </span>
              </label>
              <label className={styles.option}>
                <input type="radio" name="pairs" checked={pairs === 'raw-only'} onChange={() => setPairs('raw-only')} />
                <span>
                  Keep only the RAW <span className={styles.muted}>— saves {formatBytes(summary.pairJpegBytes)}</span>
                </span>
              </label>
            </fieldset>
          )}

          {summary.skippedNames.length > 0 && (
            <details className={styles.skipped}>
              <summary>
                {plural(summary.skippedNames.length, 'file')} {summary.skippedNames.length === 1 ? 'is not a photo' : 'are not photos'} and
                will be left out
              </summary>
              <ul>
                {summary.skippedNames.slice(0, 50).map((n, i) => (
                  <li key={`${n}-${i}`}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          {busy && <p className={styles.warn}>Another import is still running. Wait for it to finish first.</p>}
        </div>
      )}
    </Modal>
  );
}
