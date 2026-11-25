import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { HANDLES_ARROW_KEYS_ATTR } from '../a11y/arrow-keys';
import styles from './ZoomReadout.module.css';

/** A drag sweeps the zoom over this range, at 1 % a pixel (Lopsy #671). */
export const ZOOM_SCRUB_MIN = 0.1;
export const ZOOM_SCRUB_MAX = 4;
/** A press that moves less than this is a click, not a drag. */
const DEAD_ZONE_PX = 2;
/** Percentage points an arrow key moves the zoom. */
const KEY_STEP = 10;

export interface ZoomReadoutProps {
  /** The zoom, 1 for 100 %. */
  readonly zoom: number;
  /** A new zoom from a drag or an arrow key, within `min` and `max`. */
  readonly onZoom: (zoom: number) => void;
  /**
   * A double-click or Enter, and Space where the app leaves Space to the focused button (Lopsy keeps it
   * for panning): 100 %, and whatever else the app does then (Lopsy also centres the canvas).
   */
  readonly onReset: () => void;
  readonly min?: number;
  readonly max?: number;
  readonly disabled?: boolean;
  /** The app's own type and colour for the readout. */
  readonly className?: string;
  /** How to use it with a pointer: the tooltip, and what a screen reader says after the zoom. */
  readonly hint?: string;
  readonly 'data-testid'?: string;
}

/** The zoom a drag has reached `deltaPx` pixels right (positive) or left of where it started: 1 % a pixel. */
export function scrubbedZoom(startZoom: number, deltaPx: number, min = ZOOM_SCRUB_MIN, max = ZOOM_SCRUB_MAX): number {
  return Math.max(min, Math.min(max, startZoom + deltaPx / 100));
}

/** An arrow key's zoom: the next multiple of 10 % up or down, so 46 % goes to 50 % or 40 %. */
export function steppedZoom(zoom: number, direction: 1 | -1, min = ZOOM_SCRUB_MIN, max = ZOOM_SCRUB_MAX): number {
  const percent = Math.round(zoom * 100);
  const next = direction > 0 ? (Math.floor(percent / KEY_STEP) + 1) * KEY_STEP : (Math.ceil(percent / KEY_STEP) - 1) * KEY_STEP;
  return Math.max(min, Math.min(max, next / 100));
}

/**
 * The zoom level, with the conventions it has wherever it appears: drag
 * left or right on it to zoom out or in (1 % a pixel), double-click it for
 * 100 %. From the keyboard, Enter is the double-click (Space too, unless
 * the app keeps Space for itself) and the arrow keys step by 10 %. A drag
 * listens on the window until the pointer lifts, the window loses focus or
 * the page is hidden, so it never sticks.
 */
export function ZoomReadout({
  zoom,
  onZoom,
  onReset,
  min = ZOOM_SCRUB_MIN,
  max = ZOOM_SCRUB_MAX,
  disabled = false,
  className,
  hint = 'Drag left or right to zoom; double-click for 100%',
  'data-testid': testId,
}: ZoomReadoutProps) {
  const percent = Math.round(zoom * 100);
  const hintId = useId();
  const teardown = useRef<(() => void) | null>(null);
  // Whether each of the last two presses dragged: a double-click either of them dragged in is a drag and a click, not a double-click.
  const pressesDragged = useRef<[boolean, boolean]>([false, false]);
  const latest = useRef({ onZoom, min, max });
  latest.current = { onZoom, min, max };
  useEffect(() => () => teardown.current?.(), []);

  const handlePointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    teardown.current?.();
    pressesDragged.current = [pressesDragged.current[1], false];
    const startX = e.clientX;
    const startZoom = zoom;
    const pointerId = e.pointerId;
    let isDragging = false;
    const move = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const delta = ev.clientX - startX;
      if (!isDragging && Math.abs(delta) < DEAD_ZONE_PX) return;
      isDragging = true;
      pressesDragged.current[1] = true;
      const { onZoom: zoomTo, min: lo, max: hi } = latest.current;
      zoomTo(scrubbedZoom(startZoom, delta, lo, hi));
    };
    const end = () => teardown.current?.();
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') end();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    document.addEventListener('visibilitychange', onVisibility);
    teardown.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      document.removeEventListener('visibilitychange', onVisibility);
      teardown.current = null;
    };
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const direction = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
    if (direction === 0) return;
    // The arrows belong to the readout, not to the page's shortcuts: this holds them back from a
    // handler that listens in the bubble phase, HANDLES_ARROW_KEYS_ATTR from one in the capture phase.
    e.preventDefault();
    e.stopPropagation();
    onZoom(steppedZoom(zoom, direction, min, max));
  };

  return (
    <>
      <button
        type="button"
        className={[styles.readout, className].filter(Boolean).join(' ')}
        aria-label={`Zoom ${percent}%`}
        aria-describedby={hintId}
        title={hint}
        disabled={disabled}
        data-testid={testId}
        {...{ [HANDLES_ARROW_KEYS_ATTR]: '' }}
        onPointerDown={handlePointerDown}
        onClick={(e: MouseEvent<HTMLButtonElement>) => {
          // Enter and Space click with no pointer (detail 0): the keyboard's double-click.
          if (e.detail === 0) onReset();
        }}
        onDoubleClick={() => {
          if (!pressesDragged.current[0] && !pressesDragged.current[1]) onReset();
        }}
        onKeyDown={handleKeyDown}
      >
        {percent}%
      </button>
      <span id={hintId} className={styles.hint}>
        {hint}. From the keyboard: Enter for 100%, the arrow keys step by 10%.
      </span>
    </>
  );
}
