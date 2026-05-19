import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useEditorStore } from '../../app/editor-store';
import { readLayerAsImageData } from '../../engine-wasm/gpu-pixel-access';
import { pixelDataManager } from '../../engine/pixel-data-manager';
import { type Levels, type LevelsChannel, isIdentityChannel } from '../../filters/levels';
import { clamp } from '../../utils/math';
import { computeHistogram, EMPTY_HISTOGRAM, histogramPercentile, type Histogram } from './histogram-compute';
import styles from './LevelsEditor.module.css';

const CHANNEL_ORDER = ['rgb', 'r', 'g', 'b'] as const;
type ChannelKey = (typeof CHANNEL_ORDER)[number];

const CHANNEL_LABELS: Record<ChannelKey, string> = { rgb: 'RGB', r: 'R', g: 'G', b: 'B' };
const CHANNEL_TAB_COLORS: Record<ChannelKey, string> = {
  rgb: '#e0e0e0',
  r: '#ff7878',
  g: '#78dc8c',
  b: '#789cff',
};

/** Distinct shades of gray for each channel's layered histogram. Lightest
 *  on top, darkest on bottom; with 'lighter' compositing the overlap is
 *  additive so common ranges read as near-white. */
const HIST_SHADES: Record<'r' | 'g' | 'b', string> = {
  r: 'rgba(210, 210, 210, 0.55)',
  g: 'rgba(140, 140, 140, 0.55)',
  b: 'rgba( 85,  85,  85, 0.55)',
};
const HIST_SHADE_FOCUS: Record<'r' | 'g' | 'b' | 'rgb', string> = {
  rgb: 'rgba(220, 220, 220, 0.92)',
  r: 'rgba(220, 220, 220, 0.92)',
  g: 'rgba(160, 160, 160, 0.92)',
  b: 'rgba(110, 110, 110, 0.92)',
};
const HIST_SHADE_MUTED = 'rgba(60, 60, 60, 0.35)';

const TRACK_W = 256;
const HISTOGRAM_H = 90;

interface LevelsEditorProps {
  levels: Levels;
  onChange: (levels: Levels) => void;
  onReset: () => void;
  /** Optional histogram override (storybook / unit tests). */
  histogram?: Histogram;
}

export function LevelsEditor({ levels, onChange, onReset, histogram: histOverride }: LevelsEditorProps) {
  const [channel, setChannel] = useState<ChannelKey>('rgb');
  const liveHistogram = useGroupHistogram(histOverride !== undefined);
  const histogram = histOverride ?? liveHistogram;
  const ch = levels[channel];

  const updateChannel = useCallback((next: LevelsChannel) => {
    onChange({ ...levels, [channel]: next });
  }, [levels, channel, onChange]);

  const allIdentity = CHANNEL_ORDER.every((c) => isIdentityChannel(levels[c]));

  return (
    <div className={styles.section} data-testid="levels-editor">
      <div className={styles.header}>
        <span className={styles.label}>Levels</span>
        <div className={styles.channelTabs} role="tablist" aria-label="Levels channel">
          {CHANNEL_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={channel === c}
              className={`${styles.channelTab} ${channel === c ? styles.channelTabActive : ''}`}
              style={{ color: CHANNEL_TAB_COLORS[c] }}
              onClick={() => setChannel(c)}
              data-testid={`levels-channel-tab-${c}`}
            >
              {CHANNEL_LABELS[c]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.resetBtn}
          onClick={onReset}
          disabled={allIdentity}
          data-testid="levels-reset"
        >
          Reset
        </button>
      </div>

      <HistogramView histogram={histogram} channel={channel} />
      <InputAxis channel={ch} onChange={updateChannel} />
      <GradientBar />
      <OutputAxis channel={ch} onChange={updateChannel} />
    </div>
  );
}

// ─── Histogram canvas ──────────────────────────────────────────────────────

function HistogramView({ histogram, channel }: { histogram: Histogram; channel: ChannelKey }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = TRACK_W * dpr;
    canvas.height = HISTOGRAM_H * dpr;
    canvas.style.width = `${TRACK_W}px`;
    canvas.style.height = `${HISTOGRAM_H}px`;

    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, TRACK_W, HISTOGRAM_H);

    // Quartile reference grid.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = (i / 4) * TRACK_W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, HISTOGRAM_H);
      ctx.stroke();
    }

    if (histogram.total === 0) {
      ctx.fillStyle = 'rgba(160, 160, 160, 0.4)';
      ctx.font = '11px var(--font-ui)';
      ctx.textAlign = 'center';
      ctx.fillText('No image data', TRACK_W / 2, HISTOGRAM_H / 2 + 4);
      ctx.restore();
      return;
    }

    // Use the 99.5th-percentile bin height as the vertical scale so
    // a single dominant column doesn't squash everything to a flat line.
    const cap = Math.max(
      histogramPercentile(histogram.r, 0.995),
      histogramPercentile(histogram.g, 0.995),
      histogramPercentile(histogram.b, 0.995),
      1,
    );

    const drawChannel = (bins: Uint32Array, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, HISTOGRAM_H);
      for (let i = 0; i < 256; i++) {
        const x = (i / 255) * TRACK_W;
        const h = Math.min(1, bins[i]! / cap) * HISTOGRAM_H;
        ctx.lineTo(x, HISTOGRAM_H - h);
      }
      ctx.lineTo(TRACK_W, HISTOGRAM_H);
      ctx.closePath();
      ctx.fill();
    };

    if (channel === 'rgb') {
      // Layered shades of gray, additively blended so common ranges read brighter.
      ctx.globalCompositeOperation = 'lighter';
      drawChannel(histogram.b, HIST_SHADES.b);
      drawChannel(histogram.g, HIST_SHADES.g);
      drawChannel(histogram.r, HIST_SHADES.r);
    } else {
      // Single-channel: mute the others, emphasise the active one.
      ctx.globalCompositeOperation = 'source-over';
      const others: Array<'r' | 'g' | 'b'> = (['r', 'g', 'b'] as const).filter((c) => c !== channel);
      drawChannel(histogram[others[0]!], HIST_SHADE_MUTED);
      drawChannel(histogram[others[1]!], HIST_SHADE_MUTED);
      drawChannel(histogram[channel], HIST_SHADE_FOCUS[channel]);
    }

    ctx.restore();
  }, [histogram, channel]);

  return (
    <div className={styles.histogram} data-testid="levels-histogram">
      <canvas ref={canvasRef} className={styles.histogramCanvas} aria-label="Levels histogram" />
    </div>
  );
}

// ─── Input handles (black, gamma, white) ──────────────────────────────────

interface AxisProps {
  channel: LevelsChannel;
  onChange: (next: LevelsChannel) => void;
}

function InputAxis({ channel, onChange }: AxisProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const gammaFraction = inputBlackToGammaFraction(channel.gamma);
  const gamma01 = channel.inputBlack + (channel.inputWhite - channel.inputBlack) * gammaFraction;

  const handleBlackDrag = useDragHandle(trackRef, (v) => {
    const newBlack = clamp(v, 0, channel.inputWhite - 1 / 255);
    onChange({ ...channel, inputBlack: newBlack });
  });

  const handleWhiteDrag = useDragHandle(trackRef, (v) => {
    const newWhite = clamp(v, channel.inputBlack + 1 / 255, 1);
    onChange({ ...channel, inputWhite: newWhite });
  });

  const handleGammaDrag = useDragHandle(trackRef, (v) => {
    const range = channel.inputWhite - channel.inputBlack;
    if (range <= 0) return;
    const fraction = clamp((v - channel.inputBlack) / range, 0.02, 0.98);
    // gamma = -log2(fraction); fraction = 0.5^gamma
    const nextGamma = clamp(-Math.log(fraction) / Math.LN2, 0.1, 10);
    onChange({ ...channel, gamma: nextGamma });
  });

  return (
    <div className={styles.axis} data-testid="levels-input-axis">
      <div ref={trackRef} className={styles.track} data-testid="levels-input-track">
        <Handle
          position01={channel.inputBlack}
          color="#0d0d0d"
          ariaLabel="Input black"
          testId="levels-input-black-handle"
          onPointerDown={handleBlackDrag}
        />
        <Handle
          position01={gamma01}
          color="#7f7f7f"
          ariaLabel="Input gamma"
          testId="levels-input-gamma-handle"
          onPointerDown={handleGammaDrag}
        />
        <Handle
          position01={channel.inputWhite}
          color="#ffffff"
          ariaLabel="Input white"
          testId="levels-input-white-handle"
          onPointerDown={handleWhiteDrag}
        />
      </div>
      <div className={styles.readouts}>
        <span data-testid="levels-input-black-value">{Math.round(channel.inputBlack * 255)}</span>
        <span data-testid="levels-input-gamma-value">{channel.gamma.toFixed(2)}</span>
        <span data-testid="levels-input-white-value">{Math.round(channel.inputWhite * 255)}</span>
      </div>
    </div>
  );
}

function OutputAxis({ channel, onChange }: AxisProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const handleBlackDrag = useDragHandle(trackRef, (v) => {
    const newBlack = clamp(v, 0, channel.outputWhite);
    onChange({ ...channel, outputBlack: newBlack });
  });

  const handleWhiteDrag = useDragHandle(trackRef, (v) => {
    const newWhite = clamp(v, channel.outputBlack, 1);
    onChange({ ...channel, outputWhite: newWhite });
  });

  return (
    <div className={styles.axis} data-testid="levels-output-axis">
      <div ref={trackRef} className={styles.track} data-testid="levels-output-track">
        <Handle
          position01={channel.outputBlack}
          color="#0d0d0d"
          ariaLabel="Output black"
          testId="levels-output-black-handle"
          onPointerDown={handleBlackDrag}
        />
        <Handle
          position01={channel.outputWhite}
          color="#ffffff"
          ariaLabel="Output white"
          testId="levels-output-white-handle"
          onPointerDown={handleWhiteDrag}
        />
      </div>
      <div className={styles.readouts}>
        <span data-testid="levels-output-black-value">{Math.round(channel.outputBlack * 255)}</span>
        <span />
        <span data-testid="levels-output-white-value">{Math.round(channel.outputWhite * 255)}</span>
      </div>
    </div>
  );
}

// ─── Shared handle + drag hook ────────────────────────────────────────────

interface HandleProps {
  position01: number;
  color: string;
  ariaLabel: string;
  testId: string;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}

function Handle({ position01, color, ariaLabel, testId, onPointerDown }: HandleProps) {
  const left = `${clamp(position01, 0, 1) * 100}%`;
  return (
    <div
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={255}
      aria-valuenow={Math.round(position01 * 255)}
      tabIndex={0}
      className={styles.handle}
      data-testid={testId}
      style={{ left, backgroundColor: color }}
      onPointerDown={onPointerDown}
    />
  );
}

function useDragHandle(
  trackRef: React.RefObject<HTMLDivElement | null>,
  onMove: (value01: number) => void,
): (e: React.PointerEvent<HTMLDivElement>) => void {
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  return useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const track = trackRef.current;
    if (!track) return;

    const rect = track.getBoundingClientRect();
    const project = (clientX: number) => clamp((clientX - rect.left) / rect.width, 0, 1);

    const handleMove = (ev: PointerEvent) => {
      onMoveRef.current(project(ev.clientX));
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }, [trackRef]);
}

// ─── Gradient bar between input & output axes ────────────────────────────

function GradientBar() {
  return <div className={styles.gradient} aria-hidden="true" />;
}

// ─── Active group's histogram ─────────────────────────────────────────────

function useGroupHistogram(skip: boolean): Histogram {
  // Cheap subscription that fires on any layer pixel mutation.
  const pixelVersion = useSyncExternalStore(
    pixelDataManager.subscribe.bind(pixelDataManager),
    () => pixelDataManager.version(),
  );
  const activeGroupChildren = useEditorStore((s) => {
    const id = s.document.activeLayerId;
    const layers = s.document.layers;
    const active = id ? layers.find((l) => l.id === id) : undefined;
    if (active?.type === 'group') return active.children;
    const root = layers.find((l) => l.id === s.document.rootGroupId);
    return root?.type === 'group' ? root.children : [];
  });
  const layersMap = useEditorStore((s) => s.document.layers);

  const [histogram, setHistogram] = useState<Histogram>(EMPTY_HISTOGRAM);

  const childKey = useMemo(() => activeGroupChildren.join(','), [activeGroupChildren]);

  useEffect(() => {
    if (skip) return;
    let cancelled = false;
    let retries = 0;

    const tryRead = () => {
      if (cancelled) return;
      const images: ImageData[] = [];
      for (const id of activeGroupChildren) {
        const layer = layersMap.find((l) => l.id === id);
        if (!layer || !layer.visible) continue;
        if (layer.type === 'group') continue;
        const img = readLayerAsImageData(id);
        if (img) images.push(img);
      }
      if (images.length === 0) {
        // Texture may not be uploaded yet for a brand-new layer — retry a few frames.
        if (retries < 8) {
          retries++;
          requestAnimationFrame(tryRead);
        } else {
          setHistogram(EMPTY_HISTOGRAM);
        }
        return;
      }
      setHistogram(computeHistogram(images));
    };

    const rafId = requestAnimationFrame(tryRead);
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
    };
  }, [skip, childKey, pixelVersion, activeGroupChildren, layersMap]);

  return histogram;
}

// ─── Math helpers ─────────────────────────────────────────────────────────

/** Fraction along [inputBlack, inputWhite] where gamma's midtone handle sits.
 *  Inverse of: gamma = -log2(fraction). */
function inputBlackToGammaFraction(gamma: number): number {
  return Math.pow(0.5, clamp(gamma, 0.1, 10));
}
