import { afterEach, describe, expect, it } from 'vitest';
import { createFakeDrive } from '../storage/google-drive/fake-drive';
import { AccountMismatchError, fetchDriveAccountId, GOOGLE_SCOPES, GoogleTokenSource, revokeToken } from './google-token-source';
import { StaticTokenSource } from './static-token-source';

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
    const source = new GoogleTokenSource({ clientId: 'c', expectedAccountId: 'alice', fetch: about });
    expect(await source.requestInteractive()).toBe('token-for-alice');
    expect(await source.getToken()).toBe('token-for-alice');
  });

  it('refuses a grant for another account and keeps no token', async () => {
    installGis(['token-for-mallory']);
    const source = new GoogleTokenSource({ clientId: 'c', expectedAccountId: 'alice', fetch: about });
    const error = await source.requestInteractive().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AccountMismatchError);
    expect(error).toMatchObject({ code: 'auth', actualAccountId: 'mallory' });
    await expect(source.getToken()).rejects.toMatchObject({ code: 'auth' });
  });

  it('refuses a silent refresh that comes back for another account', async () => {
    installGis(['token-for-alice', 'token-for-mallory']);
    let clock = 0;
    const source = new GoogleTokenSource({ clientId: 'c', expectedAccountId: 'alice', fetch: about, now: () => clock });
    await source.requestInteractive();
    clock = 3600_000 - 2 * 60_000;
    await expect(source.getToken()).rejects.toBeInstanceOf(AccountMismatchError);
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
    await new GoogleTokenSource({ clientId: 'c', expectedAccountId: 'alice', fetch: about }).requestInteractive();
    await new GoogleTokenSource({ clientId: 'c', fetch: about }).requestInteractive();
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
