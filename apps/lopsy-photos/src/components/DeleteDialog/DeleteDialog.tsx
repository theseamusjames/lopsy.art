import { useState } from 'react';
import { getBackend } from '../../app/backend-registry';
import { useLibraryView, useOrderedIds, usePairPartners, useSession } from '../../app/hooks';
import { selectAfterRemoval } from '../../app/commands';
import { showToast } from '../../app/toasts';
import { selectOne } from '../../library/selection';
import { useUi } from '../../app/store';
import { formatBytes, plural } from '../../import/import-summary';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import styles from './DeleteDialog.module.css';

/** Confirms moving photos to the trash, naming how many and how much space. */
export function DeleteDialog() {
  const session = useSession();
  const view = useLibraryView();
  const orderedIds = useOrderedIds();
  const partners = usePairPartners();
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
    const partner = partners.get(id);
    const pair = partner ? view.assets.get(partner) : undefined;
    if (pair && !pair.deleted && !idSet.has(pair.id)) bytes += pair.byteSize;
  }
  const where = session.adapter.kind === 'google-drive' ? 'Google Drive’s trash' : 'the trash';

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const withPairs = new Set(ids);
    for (const id of ids) {
      const pair = partners.get(id);
      if (pair) withPairs.add(pair);
    }
    const removed = [...withPairs];
    const ordered = orderedIds;
    try {
      await getBackend().trashAssets(session, removed);
      askDelete([]);
      selectAfterRemoval(ordered, removed);
      showToast(`Moved ${plural(ids.length, 'photo')} to ${where}.`, 10_000, {
        label: 'Undo',
        run: () => {
          void getBackend()
            .untrashAssets(session, removed)
            .then(() => useUi.getState().setSelection(selectOne(ids[0] ?? '')))
            .catch((e: unknown) => showToast(e instanceof Error ? e.message : String(e)));
        },
      });
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
          <Button onClick={() => askDelete([])} data-autofocus>
            {ids.length === 1 ? 'Keep it' : 'Keep them'}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void confirm()}>
            Move to the trash
          </Button>
        </>
      }
    >
      <p>
        {plural(ids.length, 'photo')} ({formatBytes(bytes)}) will leave the library and go to {where}, where{' '}
        {ids.length === 1 ? 'it' : 'they'} can still be recovered for a while.
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
