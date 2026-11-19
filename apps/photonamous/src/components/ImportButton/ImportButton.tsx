import { useCallback, useRef, useState, type ChangeEvent } from 'react';
import { ChevronDown, Cloud, FolderOpen, Images, Upload } from 'lucide-react';
import { getBackend } from '../../app/backend-registry';
import { loadDriveAddMode } from '../../app/device-settings';
import { showToast } from '../../app/toasts';
import { useUi } from '../../app/store';
import { canPickFolder } from '../../import/collect-files';
import { Button } from '../Button/Button';
import { Popover } from '../Popover/Popover';
import styles from './ImportButton.module.css';

const ACCEPT = '.raf,.dng,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

/** Import photos: pick files, or a whole folder. */
export function ImportButton({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const [open, setOpen] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const setPendingImport = useUi((s) => s.setPendingImport);
  const session = useUi((s) => s.connection?.session ?? null);
  const close = useCallback(() => setOpen(false), []);

  const onPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) setPendingImport(files);
  };

  return (
    <div className={styles.wrapper}>
      <Button variant={variant} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Upload size={14} />
        Import photos
        <ChevronDown size={14} />
      </Button>
      {open && (
        <Popover onClose={close} label="Import photos">
          <div className={styles.menu} role="menu">
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                close();
                filesRef.current?.click();
              }}
            >
              <Images size={16} />
              <span>
                <span className={styles.itemTitle}>Choose photos…</span>
                <span className={styles.itemDetail}>Pick one or more files</span>
              </span>
            </button>
            {canPickFolder() && (
              <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => {
                  close();
                  folderRef.current?.click();
                }}
              >
                <FolderOpen size={16} />
                <span>
                  <span className={styles.itemTitle}>Choose a folder…</span>
                  <span className={styles.itemDetail}>Everything in it, including folders inside</span>
                </span>
              </button>
            )}
            {session && getBackend().canAddFromDrive(session) && (
              <button
                type="button"
                role="menuitem"
                className={styles.item}
                onClick={() => {
                  close();
                  getBackend()
                    .addFromDrive(session, { move: loadDriveAddMode() === 'move' })
                    .then((job) => {
                      if (job) useUi.getState().setImportJob(job);
                    })
                    .catch((error: unknown) => showToast(`Adding from Google Drive failed: ${error instanceof Error ? error.message : String(error)}`));
                }}
              >
                <Cloud size={16} />
                <span>
                  <span className={styles.itemTitle}>Add from Google Drive…</span>
                  <span className={styles.itemDetail}>Photos already in your Drive</span>
                </span>
              </button>
            )}
            <p className={styles.hint}>You can also drop photos or a folder anywhere on the window.</p>
          </div>
        </Popover>
      )}
      <input ref={filesRef} className={styles.hidden} type="file" multiple accept={ACCEPT} onChange={onPicked} />
      <input
        ref={folderRef}
        className={styles.hidden}
        type="file"
        multiple
        onChange={onPicked}
        {...{ webkitdirectory: '' }}
      />
    </div>
  );
}
