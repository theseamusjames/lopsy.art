import w120 from './photonamous-wordmark-120.png';
import w240 from './photonamous-wordmark-240.png';
import w360 from './photonamous-wordmark-360.png';
import w480 from './photonamous-wordmark-480.png';
import w720 from './photonamous-wordmark-720.png';
import w1080 from './photonamous-wordmark-1080.png';
import w1440 from './photonamous-wordmark-1440.png';
import styles from './Wordmark.module.css';

/** The slots the wordmark is drawn for: the header's narrow one, and the start screen's, where it fills its column. */
export type WordmarkSize = 'header' | 'start';

/** The header's drawing, at 1x, 2x and 3x. */
const HEADER = { width: 120, height: 21, files: [w120, w240, w360] } as const;

/** The start screen's drawings by their width in pixels; the browser takes the one its column needs. */
const START = [
  [w480, 480],
  [w720, 720],
  [w1080, 1080],
  [w1440, 1440],
] as const;
/** The wordmark's own shape, so the page keeps its place before it loads. */
const SHAPE = { width: 2040, height: 357 } as const;
/** How wide the start screen draws it: its column less the padding (StartScreen.module.css), under 560 px. */
const START_SIZES = '(max-width: 860px) min(560px, calc(100vw - 32px)), min(560px, calc(33.4vw - 64px))';

interface WordmarkProps {
  readonly size: WordmarkSize;
}

/**
 * The Photonamous wordmark: cream letters whose cap line rises like a
 * histogram, for the app's dark ground. An image, so its name is its `alt`.
 */
export function Wordmark({ size }: WordmarkProps) {
  if (size === 'start') {
    return (
      <img
        className={`${styles.wordmark} ${styles.fluid}`}
        src={w720}
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
