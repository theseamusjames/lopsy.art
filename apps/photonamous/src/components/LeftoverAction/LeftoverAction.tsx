import { useState } from 'react';
import type { FileId } from '@lopsy/photos-core/storage/types';
import { getBackend } from '../../app/backend-registry';
import { useSession } from '../../app/hooks';
import { showToast } from '../../app/toasts';
import { plural } from '../../import/import-summary';
import { Button } from '../Button/Button';

interface LeftoverActionProps {
  /** A repair's `leftovers`: originals of deleted photos still outside the trash. */
  leftovers: readonly FileId[];
  disabled?: boolean;
  /** Called after the move, to check the library again. */
  onDone: () => void;
}

/** Check library's Move to trash, for originals a failed delete left behind. */
export function LeftoverAction({ leftovers, disabled = false, onDone }: LeftoverActionProps) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  if (leftovers.length === 0) return null;
  const run = async () => {
    setBusy(true);
    try {
      const moved = await getBackend().trashLeftovers(session, leftovers);
      showToast(`Moved ${plural(moved, 'original')} of deleted photos to the trash.`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onDone();
    }
  };
  return (
    <Button size="sm" variant="primary" disabled={disabled || busy} onClick={() => void run()}>
      Move {plural(leftovers.length, 'original')} of deleted photos to the trash
    </Button>
  );
}
