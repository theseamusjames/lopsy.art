/**
 * The one full-size load a develop engine may have under way. A request
 * while one runs shares it. Cancelling (a new photo, the engine disposed)
 * aborts it and empties the slot at once, so the next request starts a
 * load of its own instead of being handed the aborted one, which rejects.
 */
export class UpgradeSlot {
  private running: { readonly abort: AbortController; readonly promise: Promise<void> } | null = null;

  isRunning(): boolean {
    return this.running !== null;
  }

  /** The load under way; null when none is. */
  current(): Promise<void> | null {
    return this.running?.promise ?? null;
  }

  /** The load under way, or a new one of `run`. `onSettled` is called when the new one ends, however it ends. */
  start(run: (signal: AbortSignal) => Promise<void>, onSettled: () => void): Promise<void> {
    if (this.running) return this.running.promise;
    const abort = new AbortController();
    // Started a microtask later, so the slot holds the run before any of its code, even a throw, can end it.
    const promise = Promise.resolve()
      .then(() => run(abort.signal))
      .finally(() => {
        // A load cancelled and replaced meanwhile leaves its successor in the slot.
        if (this.running?.abort === abort) this.running = null;
        onSettled();
      });
    this.running = { abort, promise };
    return promise;
  }

  cancel(): void {
    this.running?.abort.abort();
    this.running = null;
  }
}
