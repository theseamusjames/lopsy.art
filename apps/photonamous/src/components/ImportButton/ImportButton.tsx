import { useCallback, useId, useRef, useState, type ChangeEvent } from 'react';
import { ChevronDown, Cloud, FolderOpen, Images, Upload } from 'lucide-react';
import { getBackend } from '../../app/backend-registry';
import { loadDriveAddMode } from '../../app/device-settings';
import { showErrorToast } from '../../app/toasts';
import { useUi } from '../../app/store';
import { canPickFolder } from '../../import/collect-files';
import { Button } from '../Button/Button';
import { useMenuKeys } from '@lopsy/ui/a11y/use-menu-keys';
import { Menu, MenuItem } from '@lopsy/ui/Menu';
import styles from './ImportButton.module.css';

const ACCEPT = '.raf,.dng,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp';

/** Import photos: pick files, or a whole folder. */
export function ImportButton({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  const [open, setOpen] = useState(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const setPendingImport = useUi((s) => s.setPendingImport);
  const session = useUi((s) => s.connection?.session ?? null);
  const close = useCallback(() => setOpen(false), []);
  const menuKeys = useMenuKeys({ isOpen: open, onClose: close, onOpen: () => setOpen(true), triggerRef });
  const id = useId();

  const onPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length > 0) setPendingImport(files);
  };

  return (
    <div className={styles.wrapper}>
      <Button
        ref={triggerRef}
        variant={variant}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={menuKeys.onTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
      >
        <Upload size={14} />
        Import photos
        <ChevronDown size={14} />
      </Button>
      {open && (
        <Menu
          keys={menuKeys}
          label="Import photos"
          id={`${id}-menu`}
          className={styles.popup}
          note="You can also drop photos or a folder anywhere on the window."
        >
          <MenuItem
            icon={<Images size={16} />}
            detail="Pick one or more files"
            onSelect={() => {
              close();
              filesRef.current?.click();
            }}
          >
            Choose photos…
          </MenuItem>
          {canPickFolder() && (
            <MenuItem
              icon={<FolderOpen size={16} />}
              detail="Everything in it, including folders inside"
              onSelect={() => {
                close();
                folderRef.current?.click();
              }}
            >
              Choose a folder…
            </MenuItem>
          )}
          {session && getBackend().canAddFromDrive(session) && (
            <MenuItem
              icon={<Cloud size={16} />}
              detail="Photos already in your Drive"
              onSelect={() => {
                close();
                getBackend()
                  .addFromDrive(session, { move: loadDriveAddMode() === 'move' })
                  .then((job) => {
                    if (job) useUi.getState().setImportJob(job);
                  })
                  .catch((error: unknown) => showErrorToast(`Adding from Google Drive failed: ${error instanceof Error ? error.message : String(error)}`));
              }}
            >
              Add from Google Drive…
            </MenuItem>
          )}
        </Menu>
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
