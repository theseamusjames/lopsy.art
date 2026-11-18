import { useEffect, useState } from 'react';
import type { StorageQuota } from '@lopsy/photos-core/storage/types';
import { getBackend } from '../../app/backend-registry';
import { isSettled, useExportProgress, useImportProgress, useSession, useSyncStatus } from '../../app/hooks';
import { useUi } from '../../app/store';
import { formatBytes, plural } from '../../import/import-summary';
import { describeSync, formatWhen } from './sync-words';
import { Button } from '../Button/Button';
import styles from './SyncPanel.module.css';

/** Pending changes, last sync, errors, imports and exports in progress, and storage used. */
export function SyncPanel() {
  const session = useSession();
  const status = useSyncStatus();
  const importProgress = useImportProgress(useUi((s) => s.importJob));
  const exportProgress = useExportProgress(useUi((s) => s.exportJob));
  const [quota, setQuota] = useState<StorageQuota | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);

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
        <Button size="sm" disabled={status.state === 'syncing'} onClick={() => void session.syncNow()}>
          {status.state === 'error' || status.state === 'offline' ? 'Try again' : 'Save now'}
        </Button>
      </section>

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
        </section>
      )}

      <section className={styles.section}>
        <h3 className={styles.heading}>Storage</h3>
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
