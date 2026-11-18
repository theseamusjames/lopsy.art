import type { AssetId, VersionId } from '@lopsy/photos-core/library/types';
import { Button } from '../../components/Button/Button';
import styles from './EditSlot.module.css';

export interface EditSlotProps {
  assetId: AssetId;
  versionId: VersionId;
  onClose: () => void;
}

/** Where the Edit view goes. The real view replaces this body when it is wired. */
export function EditSlot({ assetId, versionId, onClose }: EditSlotProps) {
  return (
    <div className={styles.slot} role="region" aria-label="Edit">
      <p className={styles.message}>The editor is not wired yet.</p>
      <p className={styles.detail}>
        Photo {assetId}, version {versionId}
      </p>
      <Button variant="primary" onClick={onClose}>
        Back to the library
      </Button>
    </div>
  );
}
