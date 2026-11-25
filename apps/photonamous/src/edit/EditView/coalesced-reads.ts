/**
 * At most one engine read in flight. A read asked for while one is out
 * waits for it, and only the newest of those waiting is run, so a burst of
 * commits costs one read for the state they left, not one for each.
 */
export class CoalescedReads {
  private isReading = false;
  private next: (() => Promise<void>) | null = null;

  /** Runs `read` now, or after the read in flight, unless a newer request replaces it first. */
  request(read: () => Promise<void>): void {
    if (this.isReading) {
      this.next = read;
      return;
    }
    this.run(read);
  }

  private run(read: () => Promise<void>): void {
    this.isReading = true;
    // A read that throws before its first await is settled like one that rejects.
    Promise.resolve()
      .then(read)
      .catch(() => undefined)
      .finally(() => {
        this.isReading = false;
        const next = this.next;
        this.next = null;
        if (next) this.run(next);
      });
  }
}
