import { useMemo } from 'react';
import { clipping, formatShare, histogramPath, isClipped, parseHistogram, sharedMax } from '../histogram';
import styles from './Histogram.module.css';

export interface HistogramProps {
  /** The engine's 4 × 256 bins; null before the first read. */
  readonly bins: Uint32Array | null;
}

const WIDTH = 256;
const HEIGHT = 72;

/**
 * The histogram of the displayed render, with shadow and highlight
 * clipping indicators. The indicators light when more than a trace of any
 * channel sits at black or white; the engine has no clipping overlay yet,
 * so they do not toggle one.
 */
export function Histogram({ bins }: HistogramProps) {
  const drawn = useMemo(() => {
    const h = bins ? parseHistogram(bins) : null;
    if (!h) return null;
    const max = sharedMax(h);
    return {
      red: histogramPath(h.red, WIDTH, HEIGHT, max),
      green: histogramPath(h.green, WIDTH, HEIGHT, max),
      blue: histogramPath(h.blue, WIDTH, HEIGHT, max),
      luminance: histogramPath(h.luminance, WIDTH, HEIGHT, max),
      clip: clipping(h),
    };
  }, [bins]);

  const shadows = drawn?.clip.shadows ?? 0;
  const highlights = drawn?.clip.highlights ?? 0;

  return (
    <figure className={styles.histogram} data-testid="histogram" data-ready={drawn ? 'true' : undefined}>
      <svg className={styles.chart} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="Histogram">
        {drawn && (
          <>
            <path className={styles.red} d={drawn.red} />
            <path className={styles.green} d={drawn.green} />
            <path className={styles.blue} d={drawn.blue} />
            <path className={styles.luminance} d={drawn.luminance} />
          </>
        )}
      </svg>
      <span
        className={styles.clipShadows}
        data-clipped={isClipped(shadows) || undefined}
        data-testid="clip-shadows"
        title={`Shadows at black: ${formatShare(shadows)}`}
      />
      <span
        className={styles.clipHighlights}
        data-clipped={isClipped(highlights) || undefined}
        data-testid="clip-highlights"
        title={`Highlights at white: ${formatShare(highlights)}`}
      />
    </figure>
  );
}
