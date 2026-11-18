import { describe, expect, it } from 'vitest';
import { isClippingKey, useClippingWarning } from './clipping-warning';

const key = (k: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  target: null,
  ...extra,
});

describe('clipping warning', () => {
  it('toggles each side, and J turns both on, then both off', () => {
    const store = useClippingWarning.getState();
    store.reset();
    store.toggle('highlights');
    expect(useClippingWarning.getState()).toMatchObject({ shadows: false, highlights: true });
    useClippingWarning.getState().toggleBoth();
    expect(useClippingWarning.getState()).toMatchObject({ shadows: true, highlights: true });
    useClippingWarning.getState().toggleBoth();
    expect(useClippingWarning.getState()).toMatchObject({ shadows: false, highlights: false });
  });

  it('takes a bare J only', () => {
    expect(isClippingKey(key('j'))).toBe(true);
    expect(isClippingKey(key('J'))).toBe(true);
    expect(isClippingKey(key('j', { metaKey: true }))).toBe(false);
    expect(isClippingKey(key('k'))).toBe(false);
  });
});
