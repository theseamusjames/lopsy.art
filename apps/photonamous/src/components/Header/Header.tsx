import { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, CloudOff, Download, Keyboard, LoaderCircle, LogOut, Settings, TriangleAlert, CloudCheck } from 'lucide-react';
import { getBackend } from '../../app/backend-registry';
import { showToast } from '../../app/toasts';
import { LOCK_LOST_MESSAGE } from '@lopsy/photos-core/library/lock';
import { useSyncStatus } from '../../app/hooks';
import { useUi } from '../../app/store';
import { clearPreviewCache } from '../../app/preview-cache';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import { ImportButton } from '../ImportButton/ImportButton';
import { Popover } from '../Popover/Popover';
import { SyncPanel } from '../SyncPanel/SyncPanel';
import { ShortcutHelp } from '../ShortcutHelp/ShortcutHelp';
import { describeSync } from '../SyncPanel/sync-words';
import styles from './Header.module.css';

export function Header() {
  const connection = useUi((s) => s.connection);
  const dialog = useUi((s) => s.dialog);
  const openDialog = useUi((s) => s.openDialog);
  const selectionSize = useUi((s) => s.selection.ids.size);
  const focus = useUi((s) => s.selection.focus);
  const status = useSyncStatus();
  const [leaving, setLeaving] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const closePopover = useCallback(() => openDialog(null), [openDialog]);
  const syncButton = useRef<HTMLButtonElement>(null);
  const helpAnchor = useRef<HTMLDivElement>(null);

  // A popover closed with focus inside it (Escape, or its content went away): focus goes back to its button.
  const lastDialog = useRef(dialog);
  useEffect(() => {
    const was = lastDialog.current;
    lastDialog.current = dialog;
    if (was === dialog || (was !== 'sync' && was !== 'help')) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    (was === 'sync' ? syncButton.current : helpAnchor.current?.querySelector('button'))?.focus();
  }, [dialog]);

  if (!connection) return null;
  const exportCount = selectionSize > 0 ? selectionSize : focus !== null ? 1 : 0;

  const icon =
    status.state === 'syncing' ? (
      <LoaderCircle size={16} className={styles.spin} />
    ) : status.state === 'offline' ? (
      <CloudOff size={16} />
    ) : status.state === 'error' || status.state === 'paused' ? (
      <TriangleAlert size={16} />
    ) : status.pendingOps > 0 ? (
      <Cloud size={16} />
    ) : (
      <CloudCheck size={16} />
    );

  const signOut = async () => {
    setLeaving(true);
    try {
      await getBackend().disconnect(connection.session);
    } finally {
      clearPreviewCache();
      useUi.getState().setConnection(null);
    }
  };

  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <span className={styles.brand}>Photonamous</span>
        <span className={styles.where} title={connection.accountLabel}>
          {connection.accountLabel}
        </span>
      </div>

      <div className={styles.actions}>
        <div className={styles.anchor}>
          <button
            ref={syncButton}
            type="button"
            className={styles.sync}
            data-state={status.state}
            onClick={() => openDialog(dialog === 'sync' ? null : 'sync')}
            aria-haspopup="dialog"
            aria-expanded={dialog === 'sync'}
            title={describeSync(status)}
          >
            {icon}
            <span className={styles.syncText}>
              {status.state === 'idle' && status.pendingOps === 0 ? 'Saved' : describeSync(status).split(' — ')[0]}
            </span>
          </button>
          {dialog === 'sync' && (
            <Popover onClose={closePopover} label="Saving and storage">
              <SyncPanel />
            </Popover>
          )}
        </div>

        {status.state === 'error' && status.error === LOCK_LOST_MESSAGE && (
          <span className={styles.lost} role="alert">
            <TriangleAlert size={14} className={styles.lostIcon} />
            Opened in another tab
            <Button size="sm" variant="primary" onClick={() => location.reload()}>
              Reload to work here
            </Button>
          </span>
        )}
        {status.state === 'paused' && (
          <Button
            variant="primary"
            disabled={reconnecting}
            onClick={() => {
              setReconnecting(true);
              getBackend()
                .reauthorize(connection.session)
                .catch((error: unknown) => showToast(error instanceof Error ? error.message : String(error), 12_000))
                .finally(() => setReconnecting(false));
            }}
          >
            {connection.session.adapter.kind === 'google-drive' ? 'Reconnect Google Drive' : 'Reconnect'}
          </Button>
        )}
        <ImportButton />
        <Button
          disabled={exportCount === 0}
          onClick={() => openDialog('export')}
          title={exportCount === 0 ? 'Select photos to export them' : undefined}
        >
          <Download size={14} />
          <span>
            Export{exportCount > 0 ? ` ${exportCount.toLocaleString()}` : ''}
            {exportCount > 0 && <span className={styles.visuallyHidden}>{exportCount === 1 ? ' photo' : ' photos'}</span>}
          </span>
        </Button>

        <div className={styles.anchor} ref={helpAnchor}>
          <IconButton
            label="Keyboard shortcuts"
            icon={<Keyboard size={16} />}
            active={dialog === 'help'}
            aria-pressed={undefined}
            aria-haspopup="dialog"
            aria-expanded={dialog === 'help'}
            onClick={() => openDialog(dialog === 'help' ? null : 'help')}
          />
          {dialog === 'help' && (
            <Popover onClose={closePopover} label="Keyboard shortcuts">
              <ShortcutHelp />
            </Popover>
          )}
        </div>
        <IconButton
          label="Settings"
          icon={<Settings size={16} />}
          active={dialog === 'settings'}
          aria-pressed={undefined}
          aria-haspopup="dialog"
          aria-expanded={dialog === 'settings'}
          onClick={() => openDialog('settings')}
        />
        <IconButton
          label="Close this library"
          icon={<LogOut size={16} />}
          disabled={leaving}
          onClick={() => void signOut()}
        />
      </div>
    </header>
  );
}
