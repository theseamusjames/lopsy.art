/**
 * Calls each listener in turn, each on its own: a listener that throws is
 * logged and the rest still hear. Listeners are other people's code (a UI
 * re-rendering, a store), so what they throw is never the caller's own
 * failure: an import must not record it as a file's error, nor a sync as
 * its status.
 */
export function notifyAll(listeners: Iterable<() => void>, what: string): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error(`A listener of ${what} threw; carrying on:`, error);
    }
  }
}
