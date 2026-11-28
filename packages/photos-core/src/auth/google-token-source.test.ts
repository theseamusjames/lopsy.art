import { afterEach, describe, expect, it } from 'vitest';
import { createFakeDrive } from '../storage/google-drive/fake-drive';
import {
  AccountMismatchError,
  GESTURE_REFRESH_AGE_MS,
  GESTURE_RETRY_MS,
  GOOGLE_SCOPES,
  GoogleTokenSource,
  SILENT_RENEWAL_KEY,
  SILENT_RENEWAL_MEMORY_MS,
  fetchDriveAccountId,
  revokeToken,
} from './google-token-source';
import { StaticTokenSource } from './static-token-source';

/** The browser's memory of silent renewals, for one test. */
function noMemory(): { read(key: string): string | null; write(key: string, value: string | null): void; readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    read: (key) => values.get(key) ?? null,
    write: (key, value) => {
      if (value === null) values.delete(key);
      else values.set(key, value);
    },
  };
}

describe('fetchDriveAccountId', () => {
  it("reads Drive's ID for the account, and asks for nothing else about it", async () => {
    const drive = createFakeDrive({ account: { permissionId: '42' } });
    const asked: string[] = [];
    const id = await fetchDriveAccountId('test-token', (input, init) => {
      asked.push(String(input));
      return drive.fetch(input, init);
    });
    expect(id).toBe('42');
    expect(asked).toEqual(['https://www.googleapis.com/drive/v3/about?fields=user(permissionId)']);
  });

  it('reports a refused token as auth', async () => {
    const drive = createFakeDrive();
    await expect(fetchDriveAccountId('wrong', drive.fetch)).rejects.toMatchObject({ code: 'auth' });
  });

  it('refuses an answer without an ID', async () => {
    await expect(fetchDriveAccountId('t', async () => new Response('{"user":{}}', { status: 200 }))).rejects.toMatchObject({ code: 'unknown' });
  });
});

describe('the sign-in', () => {
  it('asks Google for the Drive files it creates and nothing else', () => {
    expect(GOOGLE_SCOPES).toBe('https://www.googleapis.com/auth/drive.file');
  });
});

describe('revokeToken', () => {
  it('posts the token and ignores failures', async () => {
    const seen: string[] = [];
    await revokeToken('abc', async (input, init) => {
      seen.push(`${String(input)} ${String(init?.body)}`);
      return new Response(null, { status: 200 });
    });
    expect(seen).toEqual(['https://oauth2.googleapis.com/revoke token=abc']);
    await revokeToken('abc', async () => {
      throw new TypeError('offline');
    });
  });
});

describe('StaticTokenSource', () => {
  it('moves to the next token on invalidate and stays on the last', async () => {
    const source = new StaticTokenSource(['a', 'b']);
    expect(await source.getToken()).toBe('a');
    source.invalidate();
    source.invalidate();
    expect(await source.getToken()).toBe('b');
    expect(await source.requestInteractive()).toBe('b');
    expect(source.invalidations).toBe(2);
  });
});

describe('GoogleTokenSource with an expected account', () => {
  /** A stand-in for google.accounts.oauth2 that grants `tokens` in turn. */
  function installGis(tokens: string[]): void {
    const oauth2 = {
      initTokenClient(config: { callback: (response: Record<string, unknown>) => void }) {
        return {
          requestAccessToken() {
            const token = tokens.shift() ?? 'none';
            setTimeout(() => config.callback({ access_token: token, expires_in: 3600, scope: 'drive.file' }), 0);
          },
        };
      },
      hasGrantedAllScopes: () => true,
    };
    Reflect.set(globalThis, 'google', { accounts: { oauth2 } });
  }

  /** Drive answers with the account a token belongs to: `token-for-<id>`. */
  const about = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    return new Response(JSON.stringify({ user: { permissionId: auth.replace('Bearer token-for-', '') } }), { status: 200 });
  };

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'google');
  });

  it('keeps a token for the expected account', async () => {
    installGis(['token-for-alice']);
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), expectedAccountId: 'alice', fetch: about });
    expect(await source.requestInteractive()).toBe('token-for-alice');
    expect(await source.getToken()).toBe('token-for-alice');
  });

  it('refuses a grant for another account and keeps no token', async () => {
    installGis(['token-for-mallory']);
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), expectedAccountId: 'alice', fetch: about });
    const error = await source.requestInteractive().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AccountMismatchError);
    expect(error).toMatchObject({ code: 'auth', actualAccountId: 'mallory' });
    await expect(source.getToken()).rejects.toMatchObject({ code: 'auth' });
  });

  it('refuses a Reconnect that comes back for another account, and says sign-in is still needed', async () => {
    installGis(['token-for-alice', 'token-for-mallory']);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), expectedAccountId: 'alice', fetch: about, now: () => clock });
    await source.requestInteractive();
    clock = 61 * 60_000;
    await expect(source.getToken()).rejects.toMatchObject({ code: 'auth' });
    expect(source.signInState()).toBe('needed');
    await expect(source.requestInteractive()).rejects.toBeInstanceOf(AccountMismatchError);
    expect(source.signInState()).toBe('needed');
    await expect(source.getToken()).rejects.toMatchObject({ code: 'auth' });
  });

  it('asks only for Drive files, hints no account, and shows consent only to an account not yet known', async () => {
    const seen: unknown[] = [];
    const oauth2 = {
      initTokenClient(config: { callback: (response: Record<string, unknown>) => void; scope: string }) {
        seen.push(config);
        return {
          requestAccessToken(overrides?: Record<string, unknown>) {
            seen.push(overrides);
            setTimeout(() => config.callback({ access_token: 'token-for-alice', expires_in: 3600 }), 0);
          },
        };
      },
      hasGrantedAllScopes: () => true,
    };
    Reflect.set(globalThis, 'google', { accounts: { oauth2 } });
    await new GoogleTokenSource({ clientId: 'c', memory: noMemory(), expectedAccountId: 'alice', fetch: about }).requestInteractive();
    await new GoogleTokenSource({ clientId: 'c', memory: noMemory(), fetch: about }).requestInteractive();
    const [knownConfig, knownRequest, newConfig, newRequest] = seen;
    expect(knownConfig).toMatchObject({ scope: 'https://www.googleapis.com/auth/drive.file' });
    expect(knownConfig).not.toHaveProperty('login_hint');
    expect(knownRequest).toEqual({ prompt: '' });
    expect(newConfig).not.toHaveProperty('login_hint');
    expect(newRequest).toEqual({ prompt: 'consent' });
  });

  it('asks Google nothing about the account when none is expected', async () => {
    installGis(['token-for-anyone']);
    let calls = 0;
    const source = new GoogleTokenSource({
      clientId: 'c',
      fetch: async (input, init) => {
        calls += 1;
        return about(input, init);
      },
    });
    expect(await source.requestInteractive()).toBe('token-for-anyone');
    expect(calls).toBe(0);
  });
});

describe('GoogleTokenSource renewing from a click', () => {
  const MINUTE = 60 * 1000;

  type Answer = { readonly token: string } | { readonly error: string } | { readonly failure: string } | { readonly never: true } | { readonly late: string };

  /**
   * A stand-in for google.accounts.oauth2 that answers each request with
   * the next of `answers`, and records the prompt each was made with.
   */
  function installGis(answers: Answer[]): { readonly prompts: string[] } {
    const prompts: string[] = [];
    const oauth2 = {
      initTokenClient(config: {
        callback: (response: Record<string, unknown>) => void;
        error_callback?: (error: { type?: string }) => void;
      }) {
        return {
          requestAccessToken(overrides?: { prompt?: string }) {
            prompts.push(overrides?.prompt ?? '');
            const answer = answers.shift() ?? { failure: 'unknown' };
            if ('never' in answer) return;
            if ('late' in answer) {
              setTimeout(() => config.callback({ access_token: answer.late, expires_in: 3600, scope: 'drive.file' }), 60);
              return;
            }
            setTimeout(() => {
              if ('token' in answer) config.callback({ access_token: answer.token, expires_in: 3600, scope: 'drive.file' });
              else if ('error' in answer) config.callback({ error: answer.error });
              else config.error_callback?.({ type: answer.failure });
            }, 0);
          },
        };
      },
      hasGrantedAllScopes: () => true,
    };
    Reflect.set(globalThis, 'google', { accounts: { oauth2 } });
    return { prompts };
  }

  const about = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    return new Response(JSON.stringify({ user: { permissionId: auth.replace('Bearer token-for-', '') } }), { status: 200 });
  };

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'google');
  });

  it('does nothing until the token is 45 minutes old, then renews it without showing anything', async () => {
    const gis = installGis([{ token: 'first' }, { token: 'second' }]);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), now: () => clock });
    await source.requestInteractive();

    clock = 44 * MINUTE;
    expect(await source.refreshOnGesture()).toBe(false);
    expect(gis.prompts).toEqual(['consent']);

    clock = GESTURE_REFRESH_AGE_MS;
    expect(await source.refreshOnGesture()).toBe(true);
    expect(gis.prompts).toEqual(['consent', 'none']);
    expect(await source.getToken()).toBe('second');

    // The new token is young again.
    clock += 10 * MINUTE;
    expect(await source.refreshOnGesture()).toBe(false);
    expect(gis.prompts).toHaveLength(2);
  });

  it('does nothing before sign-in, or once the token has run out', async () => {
    const gis = installGis([{ token: 'first' }]);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), now: () => clock });
    expect(await source.refreshOnGesture()).toBe(false);
    await source.requestInteractive();
    clock = 61 * MINUTE;
    expect(await source.refreshOnGesture()).toBe(false);
    expect(gis.prompts).toEqual(['consent']);
  });

  it('opens no window of its own: getToken gives the token while a minute is left, then says sign-in is needed', async () => {
    const gis = installGis([{ token: 'first' }]);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), now: () => clock });
    await source.requestInteractive();
    clock = 58 * MINUTE;
    expect(await source.getToken()).toBe('first');
    expect(source.signInState()).toBe('ok');
    clock = 59.5 * MINUTE;
    await expect(source.getToken()).rejects.toMatchObject({ code: 'auth' });
    expect(source.signInState()).toBe('needed');
    expect(gis.prompts).toEqual(['consent']);
  });

  it('after a silent renewal gives nothing, clicks open no more windows in this browser, and Reconnect is offered', async () => {
    const gis = installGis([{ token: 'first' }, { error: 'interaction_required' }, { token: 'second' }, { token: 'third' }, { token: 'fourth' }]);
    let clock = 0;
    const memory = noMemory();
    const source = new GoogleTokenSource({ clientId: 'c', memory, now: () => clock });
    const changes: string[] = [];
    source.subscribeSignIn(() => changes.push(source.signInState()));
    await source.requestInteractive();

    clock = 46 * MINUTE;
    expect(await source.refreshOnGesture()).toBe(false);
    expect(source.signInState()).toBe('renew');
    expect(memory.values.get(SILENT_RENEWAL_KEY)).toBe(`fails:${46 * MINUTE}`);
    expect(await source.refreshOnGesture()).toBe(false);
    expect(gis.prompts).toEqual(['consent', 'none']);
    // The token in use still works until its hour is up.
    expect(await source.getToken()).toBe('first');

    // Reconnect: a new token, and the state is ok until that one is old.
    expect(await source.requestInteractive()).toBe('second');
    expect(source.signInState()).toBe('ok');
    clock += 46 * MINUTE;
    // This browser is known not to renew silently: the click opens nothing, Reconnect is offered at once.
    expect(await source.refreshOnGesture()).toBe(false);
    expect(source.signInState()).toBe('renew');
    expect(gis.prompts).toEqual(['consent', 'none', '']);
    expect(changes).toEqual(['renew', 'ok', 'renew']);

    // A month on, clicks try again.
    const later = new GoogleTokenSource({ clientId: 'c', memory, now: () => clock + SILENT_RENEWAL_MEMORY_MS });
    clock = 0;
    await later.requestInteractive();
    clock = 46 * MINUTE;
    expect(await later.refreshOnGesture()).toBe(true);
    expect(memory.values.has(SILENT_RENEWAL_KEY)).toBe(false);
  });

  it('waits a little after a click whose popup the browser refused, then tries again', async () => {
    const gis = installGis([{ token: 'first' }, { failure: 'popup_failed_to_open' }, { token: 'second' }]);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), now: () => clock });
    await source.requestInteractive();

    clock = 46 * MINUTE;
    expect(await source.refreshOnGesture()).toBe(false);
    clock += GESTURE_RETRY_MS - 1;
    expect(await source.refreshOnGesture()).toBe(false);
    expect(gis.prompts).toEqual(['consent', 'none']);

    clock += 1;
    expect(await source.refreshOnGesture()).toBe(true);
    expect(gis.prompts).toEqual(['consent', 'none', 'none']);
  });

  it('keeps the token in use when a renewal comes back for another account', async () => {
    const gis = installGis([{ token: 'token-for-alice' }, { token: 'token-for-mallory' }]);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), expectedAccountId: 'alice', fetch: about, now: () => clock });
    await source.requestInteractive();
    clock = 46 * MINUTE;
    expect(await source.refreshOnGesture()).toBe(false);
    expect(await source.getToken()).toBe('token-for-alice');
    // Another account was signed in: no further windows from clicks.
    expect(await source.refreshOnGesture()).toBe(false);
    expect(gis.prompts).toEqual(['', 'none']);
  });

  const quick = { silent: 20, interactive: 20 };

  it('gives up a window that never answers: the token in use works, and Reconnect is offered', async () => {
    const gis = installGis([{ token: 'first' }, { never: true }, { token: 'second' }]);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), now: () => clock, requestTimeoutMs: quick });
    await source.requestInteractive();
    clock = 46 * MINUTE;
    expect(await source.refreshOnGesture()).toBe(false);
    expect(source.signInState()).toBe('renew');
    clock = 57 * MINUTE;
    expect(await source.getToken()).toBe('first');
    expect(await source.requestInteractive()).toBe('second');
    expect(gis.prompts).toEqual(['consent', 'none', '']);
  });

  it('takes a token that arrives after its request gave up, and says so', async () => {
    installGis([{ token: 'first' }, { late: 'second' }]);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), now: () => clock, requestTimeoutMs: quick });
    await source.requestInteractive();
    let told = 0;
    source.subscribe(() => told++);
    clock = 46 * MINUTE;
    expect(await source.refreshOnGesture()).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await source.getToken()).toBe('second');
    expect(told).toBe(1);
  });

  it("opens Reconnect's window while a silent request waits, and answers both", async () => {
    const gis = installGis([{ token: 'first' }, { never: true }, { token: 'second' }]);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), now: () => clock });
    await source.requestInteractive();
    clock = 46 * MINUTE;
    const silent = source.refreshOnGesture();
    const reconnect = source.requestInteractive();
    expect(await reconnect).toBe('second');
    expect(await silent).toBe(true);
    expect(gis.prompts).toEqual(['consent', 'none', '']);
  });

  it('tells work waiting for sign-in when a token comes, however it comes', async () => {
    installGis([{ token: 'first' }, { token: 'second' }]);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), now: () => clock });
    await source.requestInteractive();
    const count = source.tokenCount;
    const abort = new AbortController();
    const gaveUp = source.whenTokenAfter(count, abort.signal);
    abort.abort();
    await expect(gaveUp).rejects.toMatchObject({ code: 'aborted' });
    const waiting = source.whenTokenAfter(count);
    clock = 46 * MINUTE;
    expect(await source.refreshOnGesture()).toBe(true);
    await waiting;
    await source.whenTokenAfter(count);
  });

  it('makes one request for clicks that arrive together', async () => {
    const gis = installGis([{ token: 'first' }, { token: 'second' }]);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', memory: noMemory(), now: () => clock });
    await source.requestInteractive();
    clock = 46 * MINUTE;
    const results = await Promise.all([source.refreshOnGesture(), source.refreshOnGesture(), source.refreshOnGesture()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(gis.prompts).toEqual(['consent', 'none']);
  });
});
