/**
 * One download per key, however many callers ask at once. Every caller
 * gets the progress and the result; one caller's abort only detaches it,
 * and the download itself is cancelled once every caller has aborted.
 */

import { abortedError } from '../storage/signals';

export type ReadProgress = (receivedBytes: number, totalBytes: number | null) => void;

export interface SharedReadOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: ReadProgress;
}

interface Flight {
  readonly promise: Promise<Blob>;
  readonly controller: AbortController;
  readonly listeners: Set<ReadProgress>;
  waiters: number;
  last: [number, number | null] | null;
}

export class SharedDownloads {
  private readonly flights = new Map<string, Flight>();

  /** How many downloads are running; for tests and diagnostics. */
  get active(): number {
    return this.flights.size;
  }

  run(key: string, download: (signal: AbortSignal, onProgress: ReadProgress) => Promise<Blob>, options: SharedReadOptions = {}): Promise<Blob> {
    if (options.signal?.aborted) return Promise.reject(abortedError());
    let flight = this.flights.get(key);
    if (!flight) {
      const controller = new AbortController();
      const listeners = new Set<ReadProgress>();
      const created: Flight = {
        controller,
        listeners,
        waiters: 0,
        last: null,
        promise: Promise.resolve().then(() =>
          download(controller.signal, (received, total) => {
            created.last = [received, total];
            for (const listener of listeners) listener(received, total);
          }),
        ),
      };
      const settle = (): void => {
        if (this.flights.get(key) === created) this.flights.delete(key);
      };
      created.promise.then(settle, settle);
      this.flights.set(key, created);
      flight = created;
    }
    return this.attach(flight, options);
  }

  private attach(flight: Flight, options: SharedReadOptions): Promise<Blob> {
    const { signal, onProgress } = options;
    flight.waiters += 1;
    if (onProgress) {
      flight.listeners.add(onProgress);
      if (flight.last) onProgress(flight.last[0], flight.last[1]);
    }
    return new Promise<Blob>((resolve, reject) => {
      let detached = false;
      const detach = (): void => {
        if (detached) return;
        detached = true;
        signal?.removeEventListener('abort', onAbort);
        if (onProgress) flight.listeners.delete(onProgress);
        flight.waiters -= 1;
      };
      const onAbort = (): void => {
        detach();
        if (flight.waiters === 0) flight.controller.abort();
        reject(abortedError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      flight.promise.then(
        (blob) => {
          detach();
          resolve(blob);
        },
        (error: unknown) => {
          detach();
          reject(error);
        },
      );
    });
  }
}
