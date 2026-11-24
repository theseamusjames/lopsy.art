import type { KeyboardEvent, MouseEvent } from 'react';
import { parseItem, type ItemId } from '../../library/items';
import { useLibraryView, usePreviewUrl } from '../../app/hooks';
import styles from './Preview.module.css';

/** Where a zoomed preview is looking, as fractions of the image (0..1). */
export interface ZoomPoint {
  readonly x: number;
  readonly y: number;
}

interface PreviewProps {
  /** A grid item: an asset id (its primary version) or `assetId#versionId`. */
  itemId: ItemId;
  /** null: fit to the box. A point: the preview at full size, panned to that point. */
  zoom?: ZoomPoint | null;
  /** Click toggles zoom at the clicked point; moving pans while zoomed. */
  onZoom?: (zoom: ZoomPoint | null) => void;
}

const PAN_STEP = 0.1;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Keyboard zoom: Enter or Space looks closer at the middle and fits again; while zoomed, the arrows pan and Escape fits. */
function keyZoom(key: string, zoom: ZoomPoint | null): ZoomPoint | null | undefined {
  if (key === 'Enter' || key === ' ') return zoom ? null : { x: 0.5, y: 0.5 };
  if (!zoom) return undefined;
  switch (key) {
    case 'Escape':
      return null;
    case 'ArrowLeft':
      return { x: clamp01(zoom.x - PAN_STEP), y: zoom.y };
    case 'ArrowRight':
      return { x: clamp01(zoom.x + PAN_STEP), y: zoom.y };
    case 'ArrowUp':
      return { x: zoom.x, y: clamp01(zoom.y - PAN_STEP) };
    case 'ArrowDown':
      return { x: zoom.x, y: clamp01(zoom.y + PAN_STEP) };
    default:
      return undefined;
  }
}

function pointIn(e: MouseEvent<HTMLElement>): ZoomPoint {
  const r = e.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))),
    y: Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height))),
  };
}

/** A photo's 2048 px preview, fit to its box or zoomed; the grid thumbnail stands in while it loads. */
export function Preview({ itemId, zoom = null, onZoom }: PreviewProps) {
  const view = useLibraryView();
  const { assetId, versionId } = parseItem(itemId);
  const asset = view.assets.get(assetId);
  const version = asset ? view.versions.get(versionId ?? asset.primaryVersionId) : undefined;
  const thumb = usePreviewUrl(version?.thumb ?? null, 'thumb');
  const screen = usePreviewUrl(version?.screen ?? null, 'screen');
  const url = screen ?? thumb;
  const name = asset?.title || asset?.fileName || '';
  // Until the photo has loaded there is nothing to look closer at.
  const zoomable = onZoom !== undefined && url !== null;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onZoom || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const next = keyZoom(e.key, zoom);
    if (next === undefined) return;
    e.preventDefault();
    onZoom(next);
  };
  return (
    <div
      className={`${styles.box} ${zoomable ? styles.zoomable : ''} ${zoom ? styles.zoomed : ''}`}
      style={zoom ? ({ '--zoom-x': `${zoom.x * 100}%`, '--zoom-y': `${zoom.y * 100}%` } as React.CSSProperties) : undefined}
      onClick={zoomable ? (e) => onZoom(zoom ? null : pointIn(e)) : undefined}
      onMouseMove={zoomable && zoom ? (e) => onZoom(pointIn(e)) : undefined}
      onKeyDown={zoomable ? onKeyDown : undefined}
      // Zoomable, the photo is a toggle button named after it; the image is its text alternative otherwise.
      role={zoomable ? 'button' : undefined}
      tabIndex={zoomable ? 0 : undefined}
      aria-pressed={zoomable ? zoom !== null : undefined}
      aria-label={zoomable ? `Look closer at ${name}` : undefined}
      // No tooltip while zoomed in: the pointer is then moving over the photo to look around it, and a tooltip sits on what is being looked at.
      title={zoomable && !zoom ? 'Click to look closer' : undefined}
    >
      {url ? (
        <img
          className={styles.image}
          src={url}
          alt={name}
          draggable={false}
          data-loading={screen === null}
        />
      ) : (
        <p className={styles.loading}>Loading…</p>
      )}
    </div>
  );
}
