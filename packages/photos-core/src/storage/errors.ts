export type StorageErrorCode =
  /** The file or folder does not exist, or this app may not see it. */
  | 'not-found'
  /** The storage is full. */
  | 'quota-exceeded'
  /** Too many requests; retry later. */
  | 'rate-limited'
  /** The credentials are missing, expired or refused. */
  | 'auth'
  /** The request did not complete: offline, timed out, connection dropped. */
  | 'network'
  /** The request was cancelled through its AbortSignal. */
  | 'aborted'
  /** The backend rejected the request as malformed or not allowed. */
  | 'invalid'
  | 'unknown';

const RETRYABLE: ReadonlySet<StorageErrorCode> = new Set(['rate-limited', 'network', 'unknown']);

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  /** Whether trying the same call again later can succeed. */
  readonly retryable: boolean;
  /** HTTP status when the backend is a web API. */
  readonly status: number | null;

  constructor(code: StorageErrorCode, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'StorageError';
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    this.status = options?.status ?? null;
  }
}

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}
