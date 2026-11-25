import { useEffect, useRef, useState } from 'react';
import type { LibrarySession } from '@lopsy/photos-core/library/types';
import type { ExportFolder } from '../../app/backend';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import { focusedElement } from '@lopsy/ui/a11y/focus-trap';
import { shareWarning } from './share-words';
import styles from './ExportShare.module.css';

interface ExportShareProps {
  readonly session: LibrarySession;
  readonly folder: ExportFolder;
  /** Photos written to the folder, for the warning. */
  readonly photoCount: number;
}

type ShareState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'confirming' }
  | { readonly kind: 'working' }
  | { readonly kind: 'shared'; readonly link: string; readonly copied: boolean }
  | { readonly kind: 'error'; readonly message: string };

/**
 * After an export into the library (spec 5.5, Afterwards): Show in Drive,
 * and Copy share link, which shares the export folder with anyone who has
 * the link only after the user confirms exactly that. Shown only for
 * storage that can do these (the adapter's optional webLink and shareLink).
 * Whether the link was copied is announced; when the button that had focus
 * goes (sharing, stopping), focus moves to the link or to Copy share link.
 */
export function ExportShare({ session, folder, photoCount }: ExportShareProps) {
  const adapter = session.adapter;
  const [state, setState] = useState<ShareState>({ kind: 'idle' });
  const shareRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusedElement() !== null) return;
    if (state.kind === 'shared') linkRef.current?.focus();
    else shareRef.current?.focus();
  }, [state.kind]);
  const storageName = adapter.kind === 'google-drive' ? 'Drive' : 'storage';
  const canShare = typeof adapter.shareLink === 'function';
  if (folder.webLink === null && !canShare) return null;

  const share = async () => {
    if (!adapter.shareLink) return;
    setState({ kind: 'working' });
    try {
      const link = await adapter.shareLink(folder.id);
      const copied = await navigator.clipboard.writeText(link).then(
        () => true,
        () => false,
      );
      setState({ kind: 'shared', link, copied });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const stop = async () => {
    if (!adapter.unshare) return;
    setState({ kind: 'working' });
    try {
      await adapter.unshare(folder.id);
      setState({ kind: 'idle' });
    } catch (error) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className={styles.share} data-keeps-gesture>
      <div className={styles.actions}>
        {folder.webLink !== null && (
          <Button size="sm" onClick={() => window.open(folder.webLink ?? '', '_blank', 'noopener')}>
            Show in {storageName}
          </Button>
        )}
        {canShare && state.kind !== 'shared' && (
          <Button ref={shareRef} size="sm" aria-disabled={state.kind === 'working' || undefined} onClick={() => setState({ kind: 'confirming' })}>
            Copy share link
          </Button>
        )}
        {state.kind === 'shared' && adapter.unshare && (
          <Button size="sm" onClick={() => void stop()}>
            Stop sharing
          </Button>
        )}
      </div>
      <p className={styles.note} role="status">
        {state.kind === 'shared' ? (state.copied ? 'Link copied.' : 'Copy this link:') : ''}
      </p>
      {state.kind === 'shared' && (
        <input ref={linkRef} className={styles.link} readOnly value={state.link} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
      )}
      {state.kind === 'error' && (
        <p className={styles.error} role="alert">
          {state.message}
        </p>
      )}
      {state.kind === 'confirming' && (
        <Modal
          title="Share this export?"
          width="sm"
          onClose={() => setState({ kind: 'idle' })}
          footer={
            <>
              <Button onClick={() => setState({ kind: 'idle' })}>Cancel</Button>
              <Button variant="primary" onClick={() => void share()}>
                Share and copy link
              </Button>
            </>
          }
        >
          <p className={styles.warning}>{shareWarning(folder.name, photoCount)}</p>
        </Modal>
      )}
    </div>
  );
}
