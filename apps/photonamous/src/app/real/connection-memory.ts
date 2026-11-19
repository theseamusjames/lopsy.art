/**
 * What the app remembers between visits about where the library lives,
 * and how storage databases are named. Pure apart from the small
 * localStorage wrappers at the bottom.
 */

import type { StorageChoice } from '../backend';

/** The last storage the user opened, so the start screen can offer it again. */
export interface LastConnection {
  readonly kind: StorageChoice;
  /** For the button: the account email or the folder's name. */
  readonly label: string;
  /** Google's `sub`, so reconnecting accepts only that account. */
  readonly accountId?: string;
}

/** What the start screen offers before the full list of choices. */
export interface ReconnectOffer {
  readonly kind: StorageChoice;
  readonly label: string;
  /** Open it without asking: nothing needs the user's permission (the browser's own storage). */
  readonly automatic: boolean;
}

export const LAST_CONNECTION_KEY = 'photonamous.last-connection';

const KINDS: ReadonlySet<string> = new Set<StorageChoice>(['google-drive', 'browser', 'local-folder']);

export function parseLastConnection(raw: string | null): LastConnection | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const kind: unknown = Reflect.get(value, 'kind');
  const label: unknown = Reflect.get(value, 'label');
  if (typeof kind !== 'string' || !KINDS.has(kind) || typeof label !== 'string') return null;
  const accountId: unknown = Reflect.get(value, 'accountId');
  return typeof accountId === 'string' && accountId !== ''
    ? { kind: kind as StorageChoice, label, accountId }
    : { kind: kind as StorageChoice, label };
}

export function serializeLastConnection(last: LastConnection): string {
  return JSON.stringify({ kind: last.kind, label: last.label, ...(last.accountId ? { accountId: last.accountId } : {}) });
}

/**
 * The reconnect offer for this visit: only for storage this browser still
 * offers. A picked folder also needs its saved handle.
 */
export function reconnectOffer(
  last: LastConnection | null,
  available: readonly StorageChoice[],
  hasFolderHandle: boolean,
): ReconnectOffer | null {
  if (last === null || !available.includes(last.kind)) return null;
  if (last.kind === 'local-folder' && !hasFolderHandle) return null;
  return { kind: last.kind, label: last.label, automatic: last.kind === 'browser' };
}

/** Names safe to use inside an IndexedDB database name. */
function slug(text: string): string {
  return text.trim().replace(/[^\p{L}\p{N}@._-]+/gu, '_') || '_';
}

/** The IndexedDB database holding one storage's library state: `photonamous:<kind>:<account id or folder name>`. */
export function libraryStoreName(kind: StorageChoice, owner: string): string {
  return `photonamous:${kind}:${slug(owner)}`;
}

/** Drive's resumable upload sessions, one database per Google account. */
export function uploadSessionStoreName(accountId: string): string {
  return `photonamous-uploads:${slug(accountId)}`;
}

/** A short description of this device for the library's device list: "Chrome on macOS". */
export function describeDevice(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'A browser';
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /CrOS/.test(userAgent)
            ? 'ChromeOS'
            : /Linux/.test(userAgent)
              ? 'Linux'
              : null;
  return os === null ? browser : `${browser} on ${os}`;
}

export function loadLastConnection(): LastConnection | null {
  try {
    return parseLastConnection(localStorage.getItem(LAST_CONNECTION_KEY));
  } catch {
    return null;
  }
}

export function saveLastConnection(last: LastConnection | null): void {
  try {
    if (last === null) localStorage.removeItem(LAST_CONNECTION_KEY);
    else localStorage.setItem(LAST_CONNECTION_KEY, serializeLastConnection(last));
  } catch {
    // Storage can be blocked; reconnecting then takes one more click.
  }
}
