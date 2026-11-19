import { useMemo } from 'react';
import { clipping, describeHistogram, formatShare, histogramPath, isClipped, parseHistogram, sharedMax } from '../histogram';
import { useClippingWarning } from '../clipping-warning';
import styles from './Histogram.module.css';

export interface HistogramProps {
  /** The engine's 4 × 256 bins; null before the first read. */
  readonly bins: Uint32Array | null;
}

const WIDTH = 256;
const HEIGHT = 72;

/** The channels' line styles, named in the key under the chart, so they read without their colours. */
const KEY = [
  { id: 'red', label: 'Red' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'luminance', label: 'Luminance' },
] as const;

/**
 * The histogram of the displayed render, with shadow and highlight
 * clipping indicators. An indicator fills when more than a trace of any
 * channel sits at black or white, and each toggles the clipping warning
 * on the photo (J toggles both). Each channel has its own line style as
 * well as its colour, named in a key below.
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
      description: describeHistogram(h),
    };
  }, [bins]);

  const shadows = drawn?.clip.shadows ?? 0;
  const highlights = drawn?.clip.highlights ?? 0;
  const warning = useClippingWarning();

  return (
    <figure className={styles.histogram} data-testid="histogram" data-ready={drawn ? 'true' : undefined}>
      <div className={styles.frame}>
        <svg
          className={styles.chart}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={drawn?.description ?? describeHistogram(null)}
        >
          {drawn && (
            <>
              <path className={styles.red} d={drawn.red} />
              <path className={styles.green} d={drawn.green} />
              <path className={styles.blue} d={drawn.blue} />
              <path className={styles.luminance} d={drawn.luminance} />
            </>
          )}
        </svg>
        <button
          type="button"
          className={styles.clip}
          data-side="shadows"
          data-clipped={isClipped(shadows) || undefined}
          data-testid="clip-shadows"
          aria-pressed={warning.shadows}
          aria-label="Show shadow clipping"
          aria-keyshortcuts="J"
          title={`Shadows at black: ${formatShare(shadows)}. Click to show them in blue (J).`}
          onClick={() => warning.toggle('shadows')}
        >
          <svg className={styles.marker} viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1H9L1 9Z" />
          </svg>
        </button>
        <button
          type="button"
          className={styles.clip}
          data-side="highlights"
          data-clipped={isClipped(highlights) || undefined}
          data-testid="clip-highlights"
          aria-pressed={warning.highlights}
          aria-label="Show highlight clipping"
          aria-keyshortcuts="J"
          title={`Highlights at white: ${formatShare(highlights)}. Click to show them in red (J).`}
          onClick={() => warning.toggle('highlights')}
        >
          <svg className={styles.marker} viewBox="0 0 10 10" aria-hidden="true">
            <path d="M1 1H9V9Z" />
          </svg>
        </button>
      </div>
      <ul className={styles.key} aria-hidden="true">
        {KEY.map((k) => (
          <li key={k.id} className={styles.keyItem}>
            <svg className={styles.keyLine} viewBox="0 0 16 4">
              <line className={styles[k.id]} x1={0} y1={2} x2={16} y2={2} />
            </svg>
            {k.label}
          </li>
        ))}
      </ul>
    </figure>
  );
}
