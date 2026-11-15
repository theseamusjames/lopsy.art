import { describe, it, expect } from 'vitest';
import { chooseRenderer, parseRenderer, type RendererChoiceInput } from './renderer-choice';

const base: RendererChoiceInput = {
  search: '',
  stored: null,
  fallback: 'webgl',
  hasWebGpu: true,
  hasWgpuBuild: true,
  hasFailed: false,
};

describe('parseRenderer', () => {
  it('accepts the two renderers and nothing else', () => {
    expect(parseRenderer('wgpu')).toBe('wgpu');
    expect(parseRenderer('webgl')).toBe('webgl');
    expect(parseRenderer('vulkan')).toBeNull();
    expect(parseRenderer(undefined)).toBeNull();
  });
});

describe('chooseRenderer', () => {
  it('runs the build default when nothing asks otherwise', () => {
    expect(chooseRenderer(base)).toBe('webgl');
    expect(chooseRenderer({ ...base, fallback: 'wgpu' })).toBe('wgpu');
  });

  it('takes the stored preference over the default', () => {
    expect(chooseRenderer({ ...base, stored: 'wgpu' })).toBe('wgpu');
    expect(chooseRenderer({ ...base, fallback: 'wgpu', stored: 'webgl' })).toBe('webgl');
  });

  it('takes the URL over the stored preference', () => {
    expect(chooseRenderer({ ...base, stored: 'wgpu', search: '?renderer=webgl' })).toBe('webgl');
    expect(chooseRenderer({ ...base, stored: 'webgl', search: '?x=1&renderer=wgpu' })).toBe('wgpu');
  });

  it('ignores a value that names no renderer', () => {
    expect(chooseRenderer({ ...base, search: '?renderer=metal', stored: 'wgpu' })).toBe('wgpu');
    expect(chooseRenderer({ ...base, stored: 'fast' })).toBe('webgl');
  });

  it('falls back to WebGL where WebGPU cannot run', () => {
    const asked = { ...base, search: '?renderer=wgpu' };
    expect(chooseRenderer({ ...asked, hasWebGpu: false })).toBe('webgl');
    expect(chooseRenderer({ ...asked, hasWgpuBuild: false })).toBe('webgl');
    expect(chooseRenderer({ ...asked, hasFailed: true })).toBe('webgl');
  });
});
