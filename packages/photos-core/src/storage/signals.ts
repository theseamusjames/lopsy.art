import { StorageError } from './errors';

export function abortedError(cause?: unknown): StorageError {
  return new StorageError('aborted', 'The request was cancelled', { cause });
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortedError();
}

/** Waits `ms`, or rejects with an 'aborted' StorageError as soon as the signal fires. */
export function abortableDelay(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  throwIfAborted(signal);
  if (!signal) return sleep(ms);
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(abortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    sleep(ms).then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

export function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
