import type { MouseEvent } from 'react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { useLibraryView, usePreviewUrl } from '../../app/hooks';
import styles from './Preview.module.css';

/** Where a zoomed preview is looking, as fractions of the image (0..1). */
export interface ZoomPoint {
  readonly x: number;
  readonly y: number;
}

interface PreviewProps {
  assetId: AssetId;
  /** null: fit to the box. A point: the preview at full size, panned to that point. */
  zoom?: ZoomPoint | null;
  /** Click toggles zoom at the clicked point; moving pans while zoomed. */
  onZoom?: (zoom: ZoomPoint | null) => void;
}

function pointIn(e: MouseEvent<HTMLElement>): ZoomPoint {
  const r = e.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height))),
  };
}

/** A photo's 2048 px preview, fit to its box or zoomed; the grid thumbnail stands in while it loads. */
export function Preview({ assetId, zoom = null, onZoom }: PreviewProps) {
  const view = useLibraryView();
  const asset = view.assets.get(assetId);
  const version = asset ? view.versions.get(asset.primaryVersionId) : undefined;
  const thumb = usePreviewUrl(version?.thumb ?? null, 'thumb');
  const screen = usePreviewUrl(version?.screen ?? null, 'screen');
  const url = screen ?? thumb;
  return (
    <div
      className={`${styles.box} ${onZoom ? styles.zoomable : ''} ${zoom ? styles.zoomed : ''}`}
      style={zoom ? ({ '--zoom-x': `${zoom.x * 100}%`, '--zoom-y': `${zoom.y * 100}%` } as React.CSSProperties) : undefined}
      onClick={onZoom ? (e) => onZoom(zoom ? null : pointIn(e)) : undefined}
      onMouseMove={onZoom && zoom ? (e) => onZoom(pointIn(e)) : undefined}
      title={onZoom ? (zoom ? 'Click to fit' : 'Click to look closer') : undefined}
    >
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
