import { describe, expect, it } from 'vitest';
import { blocksCrossSiteCookies, chooseDrivePicker } from './drive-picker';

describe('chooseDrivePicker', () => {
  const facts = { pageAvailable: true, remembered: null, blocksCrossSiteCookies: false } as const;

  it('shows the Picker in the page where that can work', () => {
    expect(chooseDrivePicker(facts)).toBe('page');
  });

  it('uses a window in a browser that blocks cross-site cookies', () => {
    expect(chooseDrivePicker({ ...facts, blocksCrossSiteCookies: true })).toBe('window');
  });

  it("goes by the user's choice over the browser", () => {
    expect(chooseDrivePicker({ ...facts, remembered: 'window' })).toBe('window');
    expect(chooseDrivePicker({ ...facts, remembered: 'page', blocksCrossSiteCookies: true })).toBe('page');
  });

  it('has only the window in a build without a Picker key', () => {
    expect(chooseDrivePicker({ pageAvailable: false, remembered: 'page', blocksCrossSiteCookies: false })).toBe('window');
  });
});

describe('blocksCrossSiteCookies', () => {
  it('knows Brave by what it adds to navigator', () => {
    expect(blocksCrossSiteCookies({ brave: { isBrave: () => Promise.resolve(true) } })).toBe(true);
    expect(blocksCrossSiteCookies({ userAgent: 'Chrome' })).toBe(false);
  });
});
