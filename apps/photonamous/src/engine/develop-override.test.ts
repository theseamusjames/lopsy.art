import { describe, expect, it } from 'vitest';
import { developOverrideFrom, effectiveTextureLimit, textureLimitOverrideFrom, treatsAsFloat, usesWorkingSpace } from './develop-override';

describe('developOverrideFrom', () => {
  it('reads ?develop=legacy in a development build', () => {
    expect(developOverrideFrom('?develop=legacy', true)).toBe('legacy');
    expect(developOverrideFrom('?renderer=webgl&develop=legacy', true)).toBe('legacy');
  });

  it('reads ?develop=no-float in a development build', () => {
    expect(developOverrideFrom('?develop=no-float', true)).toBe('no-float');
    expect(developOverrideFrom('?develop=no-float', false)).toBeNull();
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

  it('keeps it off with the no-float override too', () => {
    expect(usesWorkingSpace(true, 'no-float')).toBe(false);
  });
});

describe('treatsAsFloat', () => {
  it('follows the float targets, except with the no-float override', () => {
    expect(treatsAsFloat(true, null)).toBe(true);
    expect(treatsAsFloat(true, 'legacy')).toBe(true);
    expect(treatsAsFloat(true, 'no-float')).toBe(false);
    expect(treatsAsFloat(false, null)).toBe(false);
  });
});

describe('textureLimitOverrideFrom', () => {
  it('reads ?texture-limit=N in a development build only', () => {
    expect(textureLimitOverrideFrom('?texture-limit=2048', true)).toBe(2048);
    expect(textureLimitOverrideFrom('?renderer=webgl&texture-limit=640', true)).toBe(640);
    expect(textureLimitOverrideFrom('?texture-limit=2048', false)).toBeNull();
  });

  it('ignores a value too small to edit with, or not a whole number', () => {
    expect(textureLimitOverrideFrom('?texture-limit=100', true)).toBeNull();
    expect(textureLimitOverrideFrom('?texture-limit=2048.5', true)).toBeNull();
    expect(textureLimitOverrideFrom('?texture-limit=big', true)).toBeNull();
    expect(textureLimitOverrideFrom('', true)).toBeNull();
  });

  it('only ever lowers the GPU’s own limit', () => {
    expect(effectiveTextureLimit(8192, 2048)).toBe(2048);
    expect(effectiveTextureLimit(8192, 16384)).toBe(8192);
    expect(effectiveTextureLimit(8192, null)).toBe(8192);
  });
});
