import { useMemo } from 'react';
import { Moon, Sun } from 'lucide-react';
import { clipping, clippingTitle, hdrHighlightTitle, isClipped, parseHistogram } from '../histogram';
import { useClippingWarning } from '../clipping-warning';
import styles from './ClippingButtons.module.css';

export interface ClippingButtonsProps {
  /** The engine's 4 × 256 bins; null before the first read. */
  readonly bins: Uint32Array | null;
  readonly isDisabled?: boolean;
  /** The bins are the HDR rendering's, whose top bin is the HDR peak, not white. */
  readonly isHdr?: boolean;
}

/**
 * The clipping warning's two toggles, first of the Edit view's top bar
 * tools: a moon for shadows at black, a sun for highlights at white. They
 * are the histogram's corner markers again, where the tools are: an icon
 * is filled when that end of the photo clips, and blue, as Crop is beside
 * them, while its warning is painted on the photo.
 */
export function ClippingButtons({ bins, isDisabled = false, isHdr = false }: ClippingButtonsProps) {
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
        data-testid="tool-clip-shadows"
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
        data-testid="tool-clip-highlights"
        aria-pressed={warning.highlights}
        aria-label="Show highlight clipping"
        aria-keyshortcuts="J"
        title={isHdr ? hdrHighlightTitle(clip.highlights) : clippingTitle('highlights', clip.highlights)}
        onClick={() => warning.toggle('highlights')}
        disabled={isDisabled}
      >
        <Sun size={16} fill={isClipped(clip.highlights) ? 'currentColor' : 'none'} aria-hidden />
      </button>
    </div>
  );
}
