import w120 from './photonamous-wordmark-120.png';
import w240 from './photonamous-wordmark-240.png';
import w360 from './photonamous-wordmark-360.png';
import c480 from './photonamous-wordmark-color-480.png';
import c720 from './photonamous-wordmark-color-720.png';
import c1080 from './photonamous-wordmark-color-1080.png';
import c1440 from './photonamous-wordmark-color-1440.png';
import styles from './Wordmark.module.css';

/**
 * The slots the wordmark is drawn for: the header's narrow one, in one
 * colour, and the start screen's, where it fills its column in colour.
 */
export type WordmarkSize = 'header' | 'start';

/** The header's drawing, the one-colour mark, at 1x, 2x and 3x. */
const HEADER = { width: 120, height: 21, files: [w120, w240, w360] } as const;

/** The start screen's drawings, the colour mark, by their width in pixels; the browser takes the one its column needs. */
const START = [
  [c480, 480],
  [c720, 720],
  [c1080, 1080],
  [c1440, 1440],
] as const;
/** The wordmark's own shape, so the page keeps its place before it loads. */
const SHAPE = { width: 2040, height: 357 } as const;
/** How wide the start screen draws it: its column less the padding (StartScreen.module.css), under 560 px. */
const START_SIZES = '(max-width: 860px) min(560px, calc(100vw - 32px)), min(560px, calc(33.4vw - 64px))';

interface WordmarkProps {
  readonly size: WordmarkSize;
}

/**
 * The Photonamous wordmark: letters whose cap line rises like a histogram,
 * for the app's dark ground. The header's is cream alone. The start
 * screen's has a red, a green and a blue copy standing behind the letters,
 * each rising to its own curve, as the three channels of a histogram do.
 * An image, so its name is its `alt`.
 *
 * `photonamous-wordmark-1440.png`, the one-colour mark at the start
 * screen's largest size, is not drawn here: the demo film's end card is
 * recorded with it (`e2e/demo-reel.record.ts`).
 */
export function Wordmark({ size }: WordmarkProps) {
  if (size === 'start') {
    return (
      <img
        className={`${styles.wordmark} ${styles.fluid}`}
        src={c720}
        srcSet={START.map(([file, width]) => `${file} ${width}w`).join(', ')}
        sizes={START_SIZES}
        width={SHAPE.width}
        height={SHAPE.height}
        alt="Photonamous"
        draggable={false}
      />
    );
  }
  const { width, height, files } = HEADER;
  return (
    <img
      className={styles.wordmark}
      src={files[0]}
      srcSet={`${files[0]} 1x, ${files[1]} 2x, ${files[2]} 3x`}
      width={width}
      height={height}
      alt="Photonamous"
      draggable={false}
    />
  );
}
