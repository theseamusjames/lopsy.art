/**
 * Schedules thumbnail readbacks for the Navigator panel.
 *
 * The thumbnail update calls into the WASM engine to read back the composite
 * texture, which stalls the GPU pipeline. Doing that during an active brush
 * stroke ties up the GPU and causes the brush to lag (issue #380). The
 * scheduler skips ticks while a stroke is in progress and fires one
 * catch-up tick when the stroke ends so the user sees the result.
 */

export interface SchedulerHooks {
  /** Read the composite and paint the thumbnail. */
  read: () => void;
  /** Polling interval in ms when no stroke is active. */
  intervalMs: number;
  /** Inject timer functions for tests. */
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (id: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

export interface NavigatorScheduler {
  /** Run a tick now if not stroking. Called by the interval timer. */
  tick: () => void;
  /** Update the stroking flag. When transitioning true→false, schedules
   *  one catch-up tick on the next event-loop turn. */
  setStroking: (stroking: boolean) => void;
  /** Stop the timer and forget any scheduled catch-up. */
  stop: () => void;
}

export function createNavigatorScheduler(hooks: SchedulerHooks): NavigatorScheduler {
  const setI = hooks.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearI = hooks.clearInterval ?? ((id) => clearInterval(id as ReturnType<typeof setInterval>));
  const setT = hooks.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = hooks.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));

  let stroking = false;
  let catchUpId: unknown = null;

  const tick = (): void => {
    if (stroking) return;
    hooks.read();
  };

  const intervalId = setI(tick, hooks.intervalMs);

  const setStroking = (next: boolean): void => {
    if (next === stroking) return;
    const wasStroking = stroking;
    stroking = next;
    if (wasStroking && !next) {
      // Stroke just ended — schedule one catch-up read so the thumbnail
      // reflects the final pixels without waiting up to intervalMs.
      if (catchUpId !== null) clearT(catchUpId);
      catchUpId = setT(() => {
        catchUpId = null;
        if (!stroking) hooks.read();
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

  return { tick, setStroking, stop };
}
