/**
 * Schedules thumbnail readbacks for the Navigator panel.
 *
 * The thumbnail update calls into the WASM engine to read back the composite
 * texture, which stalls the GPU pipeline. Two gates keep the cost in check:
 *
 * 1. `isInteracting` — skip ticks while any pointer gesture is in progress
 *    (drag, pan, pinch/zoom, wheel), broadened from paint strokes by #682.
 *    Fires one catch-up tick when the interaction ends.
 * 2. `getContentVersion` — skip ticks when the composite has not changed
 *    since the last successful read (#711). Zoom, pan, and pure idle all
 *    leave this counter untouched, so the readback stops during navigation
 *    and while the document sits unmodified.
 */

export interface SchedulerHooks {
  /** Read the composite and paint the thumbnail. */
  read: () => void;
  /** Polling interval in ms when no interaction is active. */
  intervalMs: number;
  /** Monotonically-increasing version of composite-affecting state.
   *  When provided, ticks are skipped unless this value has advanced since
   *  the last read. Omit to poll unconditionally each tick. */
  getContentVersion?: () => number;
  /** Inject timer functions for tests. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

export interface NavigatorScheduler {
  /** Run a tick now if no interaction is active. Called by the interval timer. */
  tick: () => void;
  /** Update the "interaction in progress" flag. When transitioning
   *  true→false, schedules one catch-up tick on the next event-loop turn. */
  setInteracting: (interacting: boolean) => void;
  /** Stop the timer and forget any scheduled catch-up. */
  stop: () => void;
}

export function createNavigatorScheduler(hooks: SchedulerHooks): NavigatorScheduler {
  const setI = hooks.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearI = hooks.clearInterval ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>));
  const setT = hooks.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = hooks.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));

  let interacting = false;
  let catchUpId: unknown = null;
  // Sentinel that never equals a real version — forces the first tick to
  // fire so the initial thumbnail paints even on a doc that never mutates.
  let lastReadVersion: number | null = null;

  const readAndRecord = (): void => {
    if (hooks.getContentVersion) {
      lastReadVersion = hooks.getContentVersion();
    }
    hooks.read();
  };

  const tick = (): void => {
    if (interacting) return;
    if (hooks.getContentVersion) {
      const v = hooks.getContentVersion();
      if (v === lastReadVersion) return;
    }
    readAndRecord();
  };

  const intervalId = setI(tick, hooks.intervalMs);

  const setInteracting = (next: boolean): void => {
    if (next === interacting) return;
    const wasInteracting = interacting;
    interacting = next;
    if (wasInteracting && !next) {
      // Interaction just ended — schedule one catch-up on the next
      // event-loop turn so the thumbnail reflects the final pixels
      // without waiting up to intervalMs. This runs through the gate so
      // gestures that changed nothing (e.g. a wheel burst that only
      // panned the viewport) don't re-read the composite (#723).
      if (catchUpId !== null) clearT(catchUpId);
      catchUpId = setT(() => {
        catchUpId = null;
        if (!interacting) tick();
      }, 0);
    }
  };

  const stop = (): void => {
    clearI(intervalId);
    if (catchUpId !== null) {
      clearT(catchUpId);
      catchUpId = null;
    }
  };

  return { tick, setInteracting, stop };
}
