import { afterEach, describe, expect, it } from 'vitest';
import { createFakeDrive } from '../storage/google-drive/fake-drive';
import { AccountMismatchError, fetchGoogleAccount, GoogleTokenSource, revokeToken } from './google-token-source';
import { StaticTokenSource } from './static-token-source';

describe('fetchGoogleAccount', () => {
  it('reads the account from userinfo', async () => {
    const drive = createFakeDrive({ account: { sub: '42', email: 'a@example.com', name: 'A' } });
    expect(await fetchGoogleAccount('test-token', drive.fetch)).toEqual({
      id: '42',
      email: 'a@example.com',
      name: 'A',
      pictureUrl: 'https://example.com/me.png',
    });
  });

  it('reports a refused token as auth', async () => {
    const drive = createFakeDrive();
    await expect(fetchGoogleAccount('wrong', drive.fetch)).rejects.toMatchObject({ code: 'auth' });
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

  /** userinfo answers with the account a token belongs to: `token-for-<sub>`. */
  const userinfo = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    const sub = auth.replace('Bearer token-for-', '');
    return new Response(JSON.stringify({ sub, email: `${sub}@example.com`, name: sub }), { status: 200 });
  };

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'google');
  });

  it('keeps a token for the expected account', async () => {
    installGis(['token-for-alice']);
    const source = new GoogleTokenSource({ clientId: 'c', expectedAccountId: 'alice', fetch: userinfo });
    expect(await source.requestInteractive()).toBe('token-for-alice');
    expect(await source.getToken()).toBe('token-for-alice');
  });

  it('refuses a grant for another account and keeps no token', async () => {
    installGis(['token-for-mallory']);
    const source = new GoogleTokenSource({ clientId: 'c', expectedAccountId: 'alice', fetch: userinfo });
    const error = await source.requestInteractive().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AccountMismatchError);
    expect(error).toMatchObject({ code: 'auth', actualAccountId: 'mallory' });
    await expect(source.getToken()).rejects.toMatchObject({ code: 'auth' });
  });

  it('refuses a silent refresh that comes back for another account', async () => {
    installGis(['token-for-alice', 'token-for-mallory']);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', expectedAccountId: 'alice', fetch: userinfo, now: () => clock });
    await source.requestInteractive();
    clock = 3600_000 - 2 * 60_000;
    await expect(source.getToken()).rejects.toBeInstanceOf(AccountMismatchError);
    await expect(source.getToken()).rejects.toMatchObject({ code: 'auth' });
  });

  it('hints the expected account to Google by its sub', async () => {
    const hints: unknown[] = [];
    const oauth2 = {
      initTokenClient(config: { callback: (response: Record<string, unknown>) => void; login_hint?: string }) {
        hints.push(config.login_hint);
        return {
          requestAccessToken(overrides?: { login_hint?: string }) {
            hints.push(overrides?.login_hint);
            setTimeout(() => config.callback({ access_token: 'token-for-alice', expires_in: 3600 }), 0);
          },
        };
      },
      hasGrantedAllScopes: () => true,
    };
    Reflect.set(globalThis, 'google', { accounts: { oauth2 } });
    const source = new GoogleTokenSource({ clientId: 'c', expectedAccountId: 'alice', fetch: userinfo });
    await source.requestInteractive();
    expect(hints).toEqual(['alice', 'alice']);
  });

  it('does not call userinfo without an expected account', async () => {
    installGis(['token-for-anyone']);
    let calls = 0;
    const source = new GoogleTokenSource({
      clientId: 'c',
      fetch: async (input, init) => {
        calls += 1;
        return userinfo(input, init);
      },
    });
    expect(await source.requestInteractive()).toBe('token-for-anyone');
    expect(calls).toBe(0);
  });
});
