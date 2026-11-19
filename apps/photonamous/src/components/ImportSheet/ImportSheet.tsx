import { useEffect, useMemo, useState } from 'react';
import type { StorageQuota } from '@lopsy/photos-core/storage/types';
import { getBackend } from '../../app/backend-registry';
import { useLibraryView, usePresets, useSession } from '../../app/hooks';
import { applyImportExtras, likelyDuplicates, parseKeywords } from '../../import/import-extras';
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
  const [presetId, setPresetId] = useState('');
  const presets = usePresets();
  const view = useLibraryView();
  const albums = useMemo(() => [...view.albums.values()].filter((a) => !a.deleted).sort((a, b) => a.name.localeCompare(b.name)), [view.albums]);
  /** '' none, 'new' a new album named below, else an album id. */
  const [album, setAlbum] = useState('');
  const [newAlbum, setNewAlbum] = useState('');
  const [keywords, setKeywords] = useState('');
  const duplicates = useMemo(() => likelyDuplicates(files ?? [], view.assets.values()), [files, view.assets]);
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

  const newCount = Math.max(0, summary.photoCount - (pairs === 'raw-only' ? summary.pairCount : 0) - duplicates.length);

  const start = () => {
    const photos = files.filter((f) => isPhotoFile(f.name));
    let albumId: string | null = album === '' || album === 'new' ? null : album;
    if (album === 'new' && newAlbum.trim() !== '') albumId = session.createAlbum(newAlbum.trim());
    const extras = { albumId, keywords: parseKeywords(keywords) };
    const job = getBackend().startImport(photos, session, {
      rawPlusJpeg: pairs,
      skipDuplicates: true,
      ...(presetId !== '' ? { presetId } : {}),
    });
    if (extras.albumId !== null || extras.keywords.length > 0) {
      void job.finished.then((progress) => applyImportExtras(session, progress, extras)).catch(() => {});
    }
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
            {newCount === 0 && duplicates.length > 0 ? 'Import anyway' : `Import ${plural(newCount, 'photo')}`}
          </Button>
        </>
      }
    >
      {summary.photoCount === 0 ? (
        <p>None of these files are photos this app can read (RAF, DNG, JPEG, PNG or WebP).</p>
      ) : (
        <div className={styles.body}>
          <p className={styles.big}>
            {plural(newCount, 'new photo')}, {formatBytes(bytes - duplicates.reduce((n, f) => n + f.size, 0))}
          </p>
          {duplicates.length > 0 && (
            <p className={styles.warn} role="note">
              {duplicates.length === 1
                ? '1 is already in the library and will be skipped'
                : `${duplicates.length.toLocaleString()} are already in the library and will be skipped`}
              {duplicates.length <= 3 && `: ${duplicates.map((f) => f.name).join(', ')}`}.
            </p>
          )}
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

          <label className={styles.preset}>
            <span className={styles.legend}>Add to album</span>
            <select value={album} onChange={(e) => setAlbum(e.target.value)} aria-label="Album for the import">
              <option value="">No album</option>
              {albums.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
              <option value="new">New album…</option>
            </select>
          </label>
          {album === 'new' && (
            <input
              className={styles.text}
              value={newAlbum}
              onChange={(e) => setNewAlbum(e.target.value)}
              aria-label="New album name"
              placeholder="Album name"
              autoFocus
            />
          )}
          <label className={styles.preset}>
            <span className={styles.legend}>Keywords</span>
            <input
              className={styles.text}
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              aria-label="Keywords for the import"
              placeholder="Separate with commas: holiday, family"
            />
          </label>

          <label className={styles.preset}>
            <span className={styles.legend}>Edits to start from</span>
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)} aria-label="Preset to apply">
              <option value="">None — as the camera took them</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

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
