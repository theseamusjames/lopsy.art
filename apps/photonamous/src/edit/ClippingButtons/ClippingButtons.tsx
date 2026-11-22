import { useMemo } from 'react';
import { Moon, Sun } from 'lucide-react';
import { clipping, clippingTitle, isClipped, parseHistogram } from '../histogram';
import { useClippingWarning } from '../clipping-warning';
import styles from './ClippingButtons.module.css';

export interface ClippingButtonsProps {
  /** The engine's 4 × 256 bins; null before the first read. */
  readonly bins: Uint32Array | null;
  readonly isDisabled?: boolean;
}

/**
 * The clipping warning's two toggles for the bar under the photo: a moon
 * for shadows at black, a sun for highlights at white. They are the
 * histogram's corner markers again, where the other view toggles are: an
 * icon is filled and coloured when that end of the photo clips, and
 * pressed while its warning is painted on the photo.
 */
export function ClippingButtons({ bins, isDisabled = false }: ClippingButtonsProps) {
  const clip = useMemo(() => {
    const h = bins ? parseHistogram(bins) : null;
    return h ? clipping(h) : { shadows: 0, highlights: 0 };
  }, [bins]);
  const warning = useClippingWarning();

  return (
    <div className={styles.buttons} role="group" aria-label="Clipping warnings">
      <button
        type="button"
        className={styles.button}
        data-side="shadows"
        data-clipped={isClipped(clip.shadows) || undefined}
        data-testid="stage-clip-shadows"
        aria-pressed={warning.shadows}
        aria-label="Show shadow clipping"
        aria-keyshortcuts="J"
        title={clippingTitle('shadows', clip.shadows)}
        onClick={() => warning.toggle('shadows')}
        disabled={isDisabled}
      >
        <Moon size={16} fill={isClipped(clip.shadows) ? 'currentColor' : 'none'} aria-hidden />
      </button>
      <button
        type="button"
        className={styles.button}
        data-side="highlights"
        data-clipped={isClipped(clip.highlights) || undefined}
        data-testid="stage-clip-highlights"
        aria-pressed={warning.highlights}
        aria-label="Show highlight clipping"
        aria-keyshortcuts="J"
        title={clippingTitle('highlights', clip.highlights)}
        onClick={() => warning.toggle('highlights')}
        disabled={isDisabled}
      >
        <Sun size={16} fill={isClipped(clip.highlights) ? 'currentColor' : 'none'} aria-hidden />
      </button>
    </div>
  );
}
