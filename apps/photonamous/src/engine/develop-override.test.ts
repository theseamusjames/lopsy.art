import { describe, expect, it } from 'vitest';
import { developOverrideFrom, usesWorkingSpace } from './develop-override';

describe('developOverrideFrom', () => {
  it('reads ?develop=legacy in a development build', () => {
    expect(developOverrideFrom('?develop=legacy', true)).toBe('legacy');
    expect(developOverrideFrom('?renderer=webgl&develop=legacy', true)).toBe('legacy');
  });

  it('ignores the query in a production build, and any other value', () => {
    expect(developOverrideFrom('?develop=legacy', false)).toBeNull();
    expect(developOverrideFrom('?develop=linear', true)).toBeNull();
    expect(developOverrideFrom('', true)).toBeNull();
  });
});

describe('usesWorkingSpace', () => {
  it('follows the float targets without the override', () => {
    expect(usesWorkingSpace(true, null)).toBe(true);
    expect(usesWorkingSpace(false, null)).toBe(false);
  });

  it('keeps the working space off with the legacy override, float or not', () => {
    expect(usesWorkingSpace(true, 'legacy')).toBe(false);
    expect(usesWorkingSpace(false, 'legacy')).toBe(false);
  });
});
