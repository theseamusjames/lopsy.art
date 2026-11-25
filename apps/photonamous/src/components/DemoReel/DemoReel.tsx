import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { IconButton } from '../IconButton/IconButton';
import av1 from './demo-reel.av1.mp4';
import h264 from './demo-reel.h264.mp4';
import poster from './demo-reel-poster.jpg';
import styles from './DemoReel.module.css';

/** Whether the reel should wait to be asked: the visitor prefers less motion, or is saving data. */
function startsStill(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
  const connection: unknown = Reflect.get(navigator, 'connection');
  return typeof connection === 'object' && connection !== null && Reflect.get(connection, 'saveData') === true;
}

/**
 * The start screen's trailer: a short silent film cut from the app itself
 * (e2e/demo-reel.record.ts records it), looping.
 *
 * It starts by itself, muted, from a poster that is on screen at once; a
 * visitor who asked for less motion or to save data gets the poster and a
 * Play button instead, and nothing is downloaded until they press it. Its
 * titles are part of the picture, so what it says is also here as text for
 * anyone who cannot see it, and the video itself is hidden from assistive
 * technology.
 */
export function DemoReel() {
  const video = useRef<HTMLVideoElement>(null);
  const [still] = useState(startsStill);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = video.current;
    if (!el || still) return;
    // React sets `muted` as a property after the element exists; browsers decide on autoplay before that.
    el.muted = true;
    el.play().catch(() => {
      // The browser refused to start it: the poster and the Play button stay.
    });
  }, [still]);

  const toggle = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {});
    else el.pause();
  };

  return (
    <section className={styles.reel} aria-label="Photonamous in use">
      <video
        ref={video}
        className={styles.video}
        poster={poster}
        muted
        loop
        playsInline
        disablePictureInPicture
        preload={still ? 'none' : 'auto'}
        aria-hidden="true"
        tabIndex={-1}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <source src={av1} type='video/mp4; codecs="av01.0.08M.08"' />
        <source src={h264} type='video/mp4; codecs="avc1.640028"' />
      </video>
      <p className={styles.spoken}>
        A short silent film of Photonamous: a library of photos, one of them picked and rated; a RAW photograph of a
        drink edited step by step, then compared before and after; the library's folders in Google Drive, opened down to
        the RAW files; and the
        Photonamous wordmark over a photograph of trees. Its titles read: Your photos. Professional editing. In your web
        browser. No servers. Your own cloud storage. Completely free. The line under the wordmark reads: RAW editing. Your
        cloud storage. Completely free.
      </p>
      <IconButton
        className={styles.toggle}
        label={playing ? 'Pause the film' : 'Play the film'}
        icon={playing ? <Pause size={16} /> : <Play size={16} />}
        onClick={toggle}
      />
    </section>
  );
}
