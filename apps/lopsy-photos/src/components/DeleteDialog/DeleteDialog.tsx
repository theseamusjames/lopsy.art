import { useState } from 'react';
import { getBackend } from '../../app/backend-registry';
import { useLibraryView, useSession } from '../../app/hooks';
import { useUi } from '../../app/store';
import { formatBytes, plural } from '../../import/import-summary';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import styles from './DeleteDialog.module.css';

/** Confirms moving photos to the trash, naming how many and how much space. */
export function DeleteDialog() {
  const session = useSession();
  const view = useLibraryView();
  const ids = useUi((s) => s.deleteIds);
  const askDelete = useUi((s) => s.askDelete);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idSet = new Set(ids);
  let bytes = 0;
  for (const id of ids) {
    const a = view.assets.get(id);
    if (!a) continue;
    bytes += a.byteSize;
    // The JPEG half of a pair goes with its RAW.
    const pair = a.pairedWith ? view.assets.get(a.pairedWith) : undefined;
    if (pair && !pair.deleted && !idSet.has(pair.id)) bytes += pair.byteSize;
  }
  const where = session.adapter.kind === 'google-drive' ? 'Google Drive’s trash' : 'the trash';

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const withPairs = new Set(ids);
    for (const id of ids) {
      const pair = view.assets.get(id)?.pairedWith;
      if (pair) withPairs.add(pair);
    }
    try {
      await getBackend().trashAssets(session, [...withPairs]);
      askDelete([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Move ${plural(ids.length, 'photo')} to the trash?`}
      width="sm"
      onClose={() => askDelete([])}
      footer={
        <>
          <Button onClick={() => askDelete([])}>Keep them</Button>
          <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
            Move to the trash
          </Button>
        </>
      }
    >
      <p>
        {plural(ids.length, 'photo')} ({formatBytes(bytes)}) will leave the library and go to {where}, where they can
        still be recovered for a while.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
