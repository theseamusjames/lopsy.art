import { useEffect, useState } from 'react';
import type { StorageQuota } from '@lopsy/photos-core/storage/types';
import { getBackend } from '../../app/backend-registry';
import { isSettled, useExportProgress, useImportProgress, useOriginalsDownload, usePreviewRefresh, useSession, useSyncStatus } from '../../app/hooks';
import { useUi } from '../../app/store';
import { formatBytes, plural } from '../../import/import-summary';
import { describeDownload, describePreviewRefresh, describeSync, downloadAnnouncement, formatWhen, previewAnnouncement, syncAnnouncement } from './sync-words';
import { useAnnouncement } from '@lopsy/ui/a11y/use-announcement';
import { Button } from '../Button/Button';
import { ExportShare } from '../ExportShare/ExportShare';
import styles from './SyncPanel.module.css';

/**
 * Pending changes, last sync, errors, imports and exports in progress, and
 * storage used. Changes of state (Saving…, Everything is saved, Offline; a
 * download or preview update starting and ending) are announced politely,
 * once each has settled.
 */
export function SyncPanel() {
  const session = useSession();
  const status = useSyncStatus();
  const importProgress = useImportProgress(useUi((s) => s.importJob));
  const exportProgress = useExportProgress(useUi((s) => s.exportJob));
  const download = getBackend().getOriginalsDownload(session);
  const downloadProgress = useOriginalsDownload(download);
  const previews = usePreviewRefresh(getBackend().getPreviewRefresh(session));
  const previewsLine = previews ? describePreviewRefresh(previews) : null;
  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const spokenSync = useAnnouncement(syncAnnouncement(status), 1500);
  const spokenDownload = useAnnouncement(downloadProgress ? downloadAnnouncement(downloadProgress) : null, 2000);
  const spokenPreviews = useAnnouncement(previews ? previewAnnouncement(previews) : null, 2000);
  const downloadAction =
    !download || !downloadProgress
      ? null
      : downloadProgress.state === 'running'
        ? { label: 'Pause', run: () => download.pause() }
        : downloadProgress.state === 'paused' || (downloadProgress.state === 'done' && downloadProgress.failed > 0)
          ? { label: downloadProgress.state === 'paused' ? 'Resume' : 'Try again', run: () => void download.resume() }
          : null;

  useEffect(() => {
    let live = true;
    getBackend()
      .getQuota(session)
      .then((q) => {
        if (live) setQuota(q);
      })
      .catch((e: unknown) => {
        if (live) setQuotaError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [session]);

  const share = quota && quota.limitBytes ? quota.usedBytes / quota.limitBytes : null;

  return (
    <div className={styles.panel}>
      <p className={styles.srOnly} role="status">
        {spokenSync}
      </p>
      <p className={styles.srOnly} role="status">
        {spokenDownload}
      </p>
      <p className={styles.srOnly} role="status">
        {spokenPreviews}
      </p>
      <section className={styles.section}>
        <h3 className={styles.heading}>{describeSync(status)}</h3>
        <dl className={styles.facts}>
          <dt>Changes waiting</dt>
          <dd>{status.pendingOps === 0 ? 'None' : plural(status.pendingOps, 'change')}</dd>
          <dt>Last saved</dt>
          <dd>{formatWhen(status.lastSyncedAt)}</dd>
          <dt>Stored in</dt>
          <dd>{session.adapter.label}</dd>
        </dl>
        {status.error && (
          <p className={styles.error} role="alert">
            {status.error}
          </p>
        )}
        <Button size="sm" aria-disabled={status.state === 'syncing' || undefined} onClick={() => void session.syncNow()}>
          {status.state === 'error' || status.state === 'offline' ? 'Try again' : 'Save now'}
        </Button>
      </section>

      {previewsLine && (
        <section className={styles.section}>
          <p className={styles.muted}>{previewsLine}</p>
        </section>
      )}

      {(importProgress || exportProgress) && (
        <section className={styles.section}>
          <h3 className={styles.heading}>In progress</h3>
          {importProgress && (
            <p className={styles.muted}>
              Import: {importProgress.items.filter((i) => isSettled(i.state)).length} of {importProgress.items.length}
              {importProgress.finished ? ' (finished)' : ''}
            </p>
          )}
          {exportProgress && (
            <p className={styles.muted}>
              Export: {exportProgress.done} of {exportProgress.total}
              {exportProgress.finished ? ' (finished)' : ''}
            </p>
          )}
          {exportProgress?.finished && exportProgress.folder && (
            <ExportShare
              session={session}
              folder={exportProgress.folder}
              photoCount={exportProgress.done - exportProgress.failures.length}
            />
          )}
        </section>
      )}

      {download && downloadProgress && (
        <section className={styles.section}>
          <h3 className={styles.heading}>Originals on this device</h3>
          <p className={styles.muted}>{describeDownload(downloadProgress)}</p>
          {downloadAction && (
            <Button size="sm" onClick={downloadAction.run}>
              {downloadAction.label}
            </Button>
          )}
        </section>
      )}

      <section className={styles.section}>
        <h3 className={styles.heading}>{session.adapter.kind === 'google-drive' ? 'Google Drive storage' : 'Storage'}</h3>
        {quota ? (
          <>
            <div className={styles.meter} data-warn={share !== null && share >= 0.9}>
              <span className={styles.fill} style={{ '--share': `${Math.min(1, share ?? 0) * 100}%` } as React.CSSProperties} />
            </div>
            <p className={styles.muted}>
              {formatBytes(quota.usedBytes)} used
              {quota.limitBytes !== null && ` of ${formatBytes(quota.limitBytes)}`}
              {share !== null && share >= 0.9 && ' — almost full'}
            </p>
          </>
        ) : (
          <p className={styles.muted}>{quotaError ? `Could not read: ${quotaError}` : 'Checking…'}</p>
        )}
      </section>
    </div>
  );
}
