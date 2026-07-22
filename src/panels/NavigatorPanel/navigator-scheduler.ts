/**
 * Schedules thumbnail readbacks for the Navigator panel.
 *
 * The thumbnail update calls into the WASM engine to read back the composite
 * texture, which stalls the GPU pipeline. Doing that during any active
 * pointer gesture ties up the GPU and causes the drag to lag (issue #380,
 * broadened by #682 from paint strokes to every pointer gesture). The
 * scheduler skips ticks while an interaction is in progress and fires one
 * catch-up tick when the interaction ends so the user sees the result.
 */

export interface SchedulerHooks {
  /** Read the composite and paint the thumbnail. */
  read: () => void;
  /** Polling interval in ms when no interaction is active. */
  intervalMs: number;
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

  const tick = (): void => {
    if (interacting) return;
    hooks.read();
  };

  const intervalId = setI(tick, hooks.intervalMs);

  const setInteracting = (next: boolean): void => {
    if (next === interacting) return;
    const wasInteracting = interacting;
    interacting = next;
    if (wasInteracting && !next) {
      // Interaction just ended — schedule one catch-up read so the thumbnail
      // reflects the final pixels without waiting up to intervalMs.
      if (catchUpId !== null) clearT(catchUpId);
      catchUpId = setT(() => {
        catchUpId = null;
        if (!interacting) hooks.read();
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
