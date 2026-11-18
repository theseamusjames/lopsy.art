import { describe, expect, it } from 'vitest';
import { cacheAccountId, checkSameAccount } from './real-backend';

describe('device cache partition', () => {
  it('keeps every picked folder apart by its root id', () => {
    expect(cacheAccountId('local-folder', 'Pictures', 'root:4f3a')).toBe('local-root_4f3a');
    expect(cacheAccountId('local-folder', 'Pictures', 'root:9c1b')).not.toBe(cacheAccountId('local-folder', 'Pictures', 'root:4f3a'));
    expect(cacheAccountId('local-folder', 'Pictures', null)).toBeNull();
  });
  it('uses the Google account for Drive and nothing for the browser', () => {
    expect(cacheAccountId('google-drive', '1234567890')).toBe('1234567890');
    expect(cacheAccountId('google-drive', 'not ok!')).toBeNull();
    expect(cacheAccountId('browser', 'opfs')).toBeNull();
  });
});

describe('checkSameAccount', () => {
  const owner = { id: '1', email: 'owner@example.com' };
  it('accepts the same account', () => {
    expect(() => checkSameAccount(owner, { id: '1', email: 'owner@example.com' })).not.toThrow();
  });
  it('refuses another account, naming both', () => {
    expect(() => checkSameAccount(owner, { id: '2', email: 'other@example.com' })).toThrow(/other@example\.com.*owner@example\.com/);
  });
});
