/**
 * Coalesce a work function so it runs at most once per animation frame.
 *
 * Every call captures the latest args; when the animation frame fires,
 * the underlying function is invoked once with only those latest args.
 * Any intermediate calls are dropped — this is the point.
 *
 * Used to tame per-pointer-move handlers that trigger expensive work
 * (GPU→CPU readbacks, full-document buffer uploads) — see issues #641,
 * #642, #643. On a 250 Hz pen tablet, the browser can fire ~4 moves per
 * 16 ms frame; without coalescing they each pay the full cost, even
 * though only the last one is visible.
 *
 * `flush()` runs the pending call synchronously on the current thread —
 * needed on pointer-up so the final position isn't lost if the caller
 * clears state before rAF has a chance to fire.
 */
export interface RafCoalescer<Args extends readonly unknown[]> {
  (...args: Args): void;
  flush: () => void;
  cancel: () => void;
}

export function coalesceToAnimationFrame<Args extends readonly unknown[]>(
  fn: (...args: Args) => void,
): RafCoalescer<Args> {
  let pending: Args | null = null;
  let rafId: number | null = null;

  // Look up rAF dynamically each schedule so a coalescer created before
  // the test harness stubs `globalThis.requestAnimationFrame` still hits
  // the stub. Cheap — one property read per rendered frame.
  const scheduleRaf = (cb: FrameRequestCallback): number =>
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(cb)
      : (setTimeout(() => cb(0), 16) as unknown as number);
  const cancelRaf = (id: number): void => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    else clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  };

  function run(): void {
    rafId = null;
    if (pending === null) return;
    const args = pending;
    pending = null;
    fn(...args);
  }

  const coalescer = ((...args: Args) => {
    pending = args;
    if (rafId !== null) return;
    rafId = scheduleRaf(run);
  }) as RafCoalescer<Args>;

  coalescer.flush = () => {
    if (rafId !== null) {
      cancelRaf(rafId);
      rafId = null;
    }
    run();
  };

  coalescer.cancel = () => {
    if (rafId !== null) {
      cancelRaf(rafId);
      rafId = null;
    }
    pending = null;
  };

  return coalescer;
}
