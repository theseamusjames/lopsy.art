import { describe, expect, it } from 'vitest';
import { createFakeDrive } from '../storage/google-drive/fake-drive';
import { fetchGoogleAccount, revokeToken } from './google-token-source';
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
