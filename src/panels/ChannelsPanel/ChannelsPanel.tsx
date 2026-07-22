import { useEffect, useRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import type { ActiveChannel, ChannelVisibility } from '../../app/ui-store';
import { getEngine } from '../../engine-wasm/engine-state';
import { readChannelThumbnail, readLayerThumbnail } from '../../engine-wasm/wasm-bridge';
import { usePixelDataVersion } from '../../engine/usePixelDataVersion';
import { contextOptions, createImageData } from '../../engine/color-space';
import type { ChannelId } from './channel-extract';
import styles from './ChannelsPanel.module.css';

const THUMB_W = 40;
const THUMB_H = 20;
const MAX_RETRIES = 10;
const THUMB_MAX = Math.max(THUMB_W, THUMB_H);

interface ChannelDef {
  id: ActiveChannel;
  label: string;
  dotClass: string;
}

const CHANNEL_DEFS: ChannelDef[] = [
  { id: 'rgb', label: 'RGB', dotClass: styles.dotRgb! },
  { id: 'r',   label: 'Red', dotClass: styles.dotR! },
  { id: 'g',   label: 'Green', dotClass: styles.dotG! },
  { id: 'b',   label: 'Blue', dotClass: styles.dotB! },
  { id: 'a',   label: 'Alpha', dotClass: styles.dotA! },
];

interface ChannelThumbnailProps {
  layerId: string;
  channel: ChannelId | 'rgb';
  pixelVersion: number;
}

function readThumbForChannel(
  layerId: string,
  channel: ChannelId | 'rgb',
): ImageData | null {
  const engine = getEngine();
  if (!engine) return null;

  // Both bridge functions return an 8-byte header [tw_u32_le, th_u32_le]
  // followed by RGBA pixels — full documentation in the Rust side.
  const data = channel === 'rgb'
    ? readLayerThumbnail(engine, layerId, THUMB_MAX)
    : readChannelThumbnail(
      engine,
      layerId,
      channel === 'r' ? 0 : channel === 'g' ? 1 : channel === 'b' ? 2 : 3,
      THUMB_MAX,
    );

  if (data.length < 8) return null;
  const tw = data[0]! | (data[1]! << 8) | (data[2]! << 16) | (data[3]! << 24);
  const th = data[4]! | (data[5]! << 8) | (data[6]! << 16) | (data[7]! << 24);
  if (tw <= 0 || th <= 0 || data.length < 8 + tw * th * 4) return null;

  const imageData = createImageData(tw, th);
  imageData.data.set(new Uint8ClampedArray(data.buffer, data.byteOffset + 8, tw * th * 4));
  return imageData;
}

function ChannelThumbnail({ layerId, channel, pixelVersion }: ChannelThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let retries = 0;
    let rafId = 0;

    const tryRead = () => {
      if (cancelled) return;

      const ctx = canvas.getContext('2d', contextOptions);
      if (!ctx) return;

      canvas.width = THUMB_W;
      canvas.height = THUMB_H;

      // GPU-side downscale: readChannelThumbnail / readLayerThumbnail render
      // into a small (≤THUMB_MAX) RGBA8 texture and read back only that.
      // Previously each thumbnail did a full-doc GPU→CPU readback, so a 4K
      // layer with the panel open moved ~67 MB per channel per pixel-version
      // bump (5 thumbnails × ~67 MB) — see #683.
      const sourceData = readThumbForChannel(layerId, channel);
      if (!sourceData) {
        ctx.clearRect(0, 0, THUMB_W, THUMB_H);
        if (retries < MAX_RETRIES) {
          retries++;
          rafId = requestAnimationFrame(tryRead);
        }
        return;
      }

      ctx.clearRect(0, 0, THUMB_W, THUMB_H);
      // The thumbnail may not exactly match the canvas aspect — center it
      // and letterbox, same as before. The pixel-per-pixel put is cheap
      // because sourceData is at most THUMB_MAX px on a side.
      if (sourceData.width === THUMB_W && sourceData.height === THUMB_H) {
        ctx.putImageData(sourceData, 0, 0);
      } else {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = sourceData.width;
        tempCanvas.height = sourceData.height;
        const tempCtx = tempCanvas.getContext('2d', contextOptions);
        if (!tempCtx) return;
        tempCtx.putImageData(sourceData, 0, 0);
        const scale = Math.min(THUMB_W / sourceData.width, THUMB_H / sourceData.height);
        const w = sourceData.width * scale;
        const h = sourceData.height * scale;
        ctx.drawImage(tempCanvas, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h);
      }
    };

    rafId = requestAnimationFrame(tryRead);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [layerId, channel, pixelVersion]);

  return (
    <div className={styles.thumbnail}>
      <canvas ref={canvasRef} className={styles.thumbnailCanvas} />
    </div>
  );
}

export function ChannelsPanel() {
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const channelVisibility = useUIStore((s) => s.channelVisibility);
  const activeChannel = useUIStore((s) => s.activeChannel);
  const toggleChannelVisibility = useUIStore((s) => s.toggleChannelVisibility);
  const setActiveChannel = useUIStore((s) => s.setActiveChannel);

  const pixelVersion = usePixelDataVersion(activeLayerId ?? '');

  const isChannelVisible = (id: ActiveChannel): boolean => {
    if (id === 'rgb') return true;
    return channelVisibility[id as keyof ChannelVisibility];
  };

  return (
    <div className={styles.panel}>
      <div className={styles.channelList} data-testid="channels-list">
        {CHANNEL_DEFS.map(({ id, label, dotClass }) => {
          const isVisible = isChannelVisible(id);
          const isActive = activeChannel === id;
          const isDisabled = id !== 'rgb' && !channelVisibility[id as keyof ChannelVisibility];

          return (
            <div
              key={id}
              className={[
                styles.row,
                isActive ? styles.rowActive : '',
                isDisabled ? styles.rowDisabled : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setActiveChannel(id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setActiveChannel(id);
              }}
              data-testid={`channel-row-${id}`}
              aria-selected={isActive}
            >
              <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />
              <span className={styles.channelName}>{label}</span>
              {activeLayerId && (
                <ChannelThumbnail
                  layerId={activeLayerId}
                  channel={id}
                  pixelVersion={pixelVersion}
                />
              )}
              {id !== 'rgb' && (
                <button
                  className={styles.visibilityBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleChannelVisibility(id as keyof ChannelVisibility);
                  }}
                  type="button"
                  aria-label={isVisible ? `Hide ${label} channel` : `Show ${label} channel`}
                  data-testid={`channel-visibility-${id}`}
                >
                  {isVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
