import type { AssetId } from '@lopsy/photos-core/library/types';
import { useLibraryView, usePreviewUrl } from '../../app/hooks';
import styles from './Preview.module.css';

interface PreviewProps {
  assetId: AssetId;
}

/** A photo's 2048 px preview, fit to its box; the grid thumbnail stands in while it loads. */
export function Preview({ assetId }: PreviewProps) {
  const view = useLibraryView();
  const asset = view.assets.get(assetId);
  const version = asset ? view.versions.get(asset.primaryVersionId) : undefined;
  const thumb = usePreviewUrl(version?.thumb ?? null, 'thumb');
  const screen = usePreviewUrl(version?.screen ?? null, 'screen');
  const url = screen ?? thumb;
  return (
    <div className={styles.box}>
      {url ? (
        <img
          className={styles.image}
          src={url}
          alt={asset?.title || asset?.fileName || ''}
          draggable={false}
          data-loading={screen === null}
        />
      ) : (
        <p className={styles.loading}>Loading…</p>
      )}
    </div>
  );
}
