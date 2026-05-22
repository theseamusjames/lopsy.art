import { useEffect, useRef } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { PanelContainer } from '../PanelContainer/PanelContainer';
import { usePanelCollapse } from '../usePanelCollapse';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import type { ActiveChannel, ChannelVisibility } from '../../app/ui-store';
import { readLayerAsImageData } from '../../engine-wasm/gpu-pixel-access';
import { getEngine } from '../../engine-wasm/engine-state';
import { extractChannelPixels, getLayerTextureDimensions } from '../../engine-wasm/wasm-bridge';
import { usePixelDataVersion } from '../../engine/usePixelDataVersion';
import { contextOptions, createImageData } from '../../engine/color-space';
import type { ChannelId } from './channel-extract';
import styles from './ChannelsPanel.module.css';

const THUMB_W = 40;
const THUMB_H = 20;
const MAX_RETRIES = 10;

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

      const imageData = readLayerAsImageData(layerId);
      if (!imageData) {
        ctx.clearRect(0, 0, THUMB_W, THUMB_H);
        if (retries < MAX_RETRIES) {
          retries++;
          rafId = requestAnimationFrame(tryRead);
        }
        return;
      }

      let sourceData: ImageData;
      if (channel === 'rgb') {
        sourceData = imageData;
      } else {
        const engine = getEngine();
        const channelIdx = channel === 'r' ? 0 : channel === 'g' ? 1 : channel === 'b' ? 2 : 3;
        if (engine) {
          const dims = getLayerTextureDimensions(engine, layerId);
          const tw = dims[0] ?? 0;
          const th = dims[1] ?? 0;
          if (tw > 0 && th > 0) {
            const pixels = extractChannelPixels(engine, layerId, channelIdx);
            if (pixels.length === tw * th * 4) {
              sourceData = createImageData(tw, th);
              sourceData.data.set(new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength));
            } else {
              sourceData = imageData;
            }
          } else {
            sourceData = imageData;
          }
        } else {
          sourceData = imageData;
        }
      }

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = sourceData.width;
      tempCanvas.height = sourceData.height;
      const tempCtx = tempCanvas.getContext('2d', contextOptions);
      if (!tempCtx) return;
      tempCtx.putImageData(sourceData, 0, 0);

      ctx.clearRect(0, 0, THUMB_W, THUMB_H);
      const scale = Math.min(THUMB_W / sourceData.width, THUMB_H / sourceData.height);
      const w = sourceData.width * scale;
      const h = sourceData.height * scale;
      ctx.drawImage(tempCanvas, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h);
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
  const [collapsed, setCollapsed] = usePanelCollapse('channels');
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
    <PanelContainer title="Channels" collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)}>
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
                {!collapsed && activeLayerId && (
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
    </PanelContainer>
  );
}
