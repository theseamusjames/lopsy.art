import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** sessionStorage as the page has it, in Node. */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
}

async function load(search: string, hasGpu: boolean) {
  vi.stubGlobal('location', { search });
  vi.stubGlobal('navigator', hasGpu ? { gpu: {} } : {});
  return import('./renderer-choice');
}

describe('requestedRenderer', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('sessionStorage', memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for WebGPU by default where the browser has it', async () => {
    const choice = await load('', true);
    expect(choice.requestedRenderer('wgpu', true)).toBe('wgpu');
  });

  it('runs WebGL where the browser has no WebGPU, or the build has no wgpu package', async () => {
    expect((await load('', false)).requestedRenderer('wgpu', true)).toBe('webgl');
    vi.resetModules();
    expect((await load('', true)).requestedRenderer('wgpu', false)).toBe('webgl');
  });

  it('follows ?renderer= over the default either way', async () => {
    expect((await load('?renderer=webgl', true)).requestedRenderer('wgpu', true)).toBe('webgl');
    vi.resetModules();
    expect((await load('?renderer=wgpu', true)).requestedRenderer('webgl', true)).toBe('wgpu');
  });

  it('runs WebGL for the rest of the tab once WebGPU has failed to start', async () => {
    const choice = await load('?renderer=wgpu', true);
    choice.markWgpuFailed();
    expect(sessionStorage.getItem(choice.RENDERER_FAILED_KEY)).toBe('1');
    expect(choice.requestedRenderer('wgpu', true)).toBe('webgl');
  });
});

describe('fallBackToWebgl', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('sessionStorage', memoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cannot change a page that did not choose wgpu', async () => {
    const choice = await load('', true);
    expect(await choice.fallBackToWebgl()).toBe(false);
  });

  it('changes once, and tells a second caller the page runs WebGL too', async () => {
    const choice = await load('', true);
    const fallBack = vi.fn(async () => {});
    choice.setWebglFallback(fallBack);
    const [first, second] = await Promise.all([choice.fallBackToWebgl(), choice.fallBackToWebgl()]);
    expect([first, second]).toEqual([true, true]);
    expect(fallBack).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(choice.RENDERER_FAILED_KEY)).toBe('1');
  });

  it('says so when the WebGL build cannot start either', async () => {
    const choice = await load('', true);
    choice.setWebglFallback(async () => {
      throw new Error('no WebGL');
    });
    expect(await choice.fallBackToWebgl()).toBe(false);
  });
});
