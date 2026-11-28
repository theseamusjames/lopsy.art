/**
 * An import against the fake Drive through the real GoogleDriveAdapter and
 * GoogleTokenSource, with Google's sign-in stubbed and the clock in the
 * test's hands: a token lives an hour on this clock and the fake Drive
 * refuses it (401) once it has run out, as Google does.
 */

import { GoogleTokenSource } from '../../auth/google-token-source';
import { GoogleDriveAdapter } from '../../storage/google-drive/drive-adapter';
import { createFakeDrive, type FakeDrive } from '../../storage/google-drive/fake-drive';
import { MemoryUploadSessionStore } from '../../storage/google-drive/upload-sessions';
import { FakeLibrarySession } from './fake-session';

/** What the stub's sign-in does with a request, by its prompt ('none' is the silent one). */
export type GisAnswer = 'grant' | 'never' | 'blocked' | 'closed';

export interface DriveImportHarness {
  readonly drive: FakeDrive;
  readonly adapter: GoogleDriveAdapter;
  readonly tokens: GoogleTokenSource;
  readonly session: FakeLibrarySession;
  readonly uploadSessions: MemoryUploadSessionStore;
  /** Milliseconds on the harness's clock. */
  now(): number;
  advance(ms: number): void;
  /** Every prompt the page asked Google with, in order. */
  readonly prompts: string[];
  /** Decides each sign-in request's fate; 'grant' by default. */
  answer: (prompt: string) => GisAnswer;
  /** Holds a Drive request until the promise settles (null: not held); an aborted request gives up, as fetch does. */
  hold: (request: Request) => Promise<void> | null;
  /** Sees every Drive request before the fake Drive does (to move the clock, or expire tokens, mid-upload). */
  beforeFetch: (request: Request) => void;
  /** Expires every token granted so far, as Google would at the end of its hour. */
  expireAll(): void;
}

const HOUR = 60 * 60 * 1000;

export async function driveImportHarness(options: { readonly chunkSize?: number; readonly resumableThreshold?: number } = {}): Promise<DriveImportHarness> {
  let clock = Date.UTC(2026, 10, 18, 12);
  const expiries = new Map<string, number>();
  const drive = createFakeDrive({ tokens: [], now: () => new Date(clock) });
  const prompts: string[] = [];
  let granted = 0;
  const harness: {
    answer: (prompt: string) => GisAnswer;
    beforeFetch: (request: Request) => void;
    hold: (request: Request) => Promise<void> | null;
  } = {
    answer: () => 'grant',
    beforeFetch: () => {},
    hold: () => null,
  };
  const oauth2 = {
    initTokenClient(config: {
      callback: (response: Record<string, unknown>) => void;
      error_callback?: (error: { type?: string; message?: string }) => void;
    }) {
      return {
        requestAccessToken(overrides?: { prompt?: string }) {
          const prompt = overrides?.prompt ?? '';
          prompts.push(prompt);
          const fate = harness.answer(prompt);
          if (fate === 'never') return;
          setTimeout(() => {
            if (fate === 'blocked') config.error_callback?.({ type: 'popup_failed_to_open', message: 'Failed to open popup window' });
            else if (fate === 'closed') config.error_callback?.({ type: 'popup_closed', message: 'Popup window closed' });
            else {
              const token = `token-${++granted}`;
              expiries.set(token, clock + HOUR);
              drive.addToken(token);
              config.callback({ access_token: token, expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' });
            }
          }, 0);
        },
      };
    },
    hasGrantedAllScopes: () => true,
  };
  Reflect.set(globalThis, 'google', { accounts: { oauth2 } });

  const refuseExpired = () => {
    for (const [token, expiresAt] of expiries) if (clock >= expiresAt) drive.revokeToken(token);
  };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    harness.beforeFetch(request);
    // A held request waits, as a slow upload does, and gives up when its signal aborts, as fetch does.
    const held = harness.hold(request);
    if (held) {
      const signal = init?.signal;
      await new Promise<void>((resolve, reject) => {
        const aborted = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
        if (signal?.aborted) return aborted();
        signal?.addEventListener('abort', aborted, { once: true });
        held.then(resolve, reject);
      });
    }
    refuseExpired();
    return drive.fetch(input, init);
  };
  const remembered = new Map<string, string>();
  const memory = {
    read: (key: string) => remembered.get(key) ?? null,
    write: (key: string, value: string | null) => void (value === null ? remembered.delete(key) : remembered.set(key, value)),
  };
  const tokens = new GoogleTokenSource({ clientId: 'test-client', now: () => clock, requestTimeoutMs: { silent: 20, interactive: 20 }, memory });
  await tokens.requestInteractive();
  const uploadSessions = new MemoryUploadSessionStore();
  const adapter = new GoogleDriveAdapter({
    tokenSource: tokens,
    label: 'Google Drive',
    fetch,
    now: () => clock,
    sleep: async () => {},
    random: () => 0,
    requestsPerSecond: Number.POSITIVE_INFINITY,
    uploadSessions,
    ...(options.chunkSize !== undefined ? { chunkSize: options.chunkSize } : {}),
    ...(options.resumableThreshold !== undefined ? { resumableThreshold: options.resumableThreshold } : {}),
  });
  const root = await adapter.getRoot();
  const originals = await adapter.createFolder(root.id, 'Originals');
  const previews = await adapter.createFolder(root.id, 'previews');
  const session = new FakeLibrarySession(adapter, { rootId: root.id, originalsId: originals.id, previewsId: previews.id });
  return {
    drive,
    adapter,
    tokens,
    session,
    uploadSessions,
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
    prompts,
    get answer() {
      return harness.answer;
    },
    set answer(value) {
      harness.answer = value;
    },
    get hold() {
      return harness.hold;
    },
    set hold(value) {
      harness.hold = value;
    },
    get beforeFetch() {
      return harness.beforeFetch;
    },
    set beforeFetch(value) {
      harness.beforeFetch = value;
    },
    expireAll: () => {
      for (const token of expiries.keys()) expiries.set(token, Math.min(expiries.get(token) ?? clock, clock));
      refuseExpired();
    },
  };
}

export function removeGis(): void {
  Reflect.deleteProperty(globalThis, 'google');
}
