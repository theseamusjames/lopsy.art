// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function stubAdapter(maxTextureDimension2D: number | undefined): void {
  vi.stubGlobal('navigator', {
    gpu: { requestAdapter: async () => ({ limits: { maxTextureDimension2D } }) },
  });
}

describe('getGpuMaxTextureSize', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is the WebGPU adapter\'s limit on a page that runs the wgpu engine', async () => {
    stubAdapter(8192);
    const choice = await import('./renderer-choice');
    const { getGpuMaxTextureSize } = await import('./gpu-limits');
    expect(await choice.canUseWebGpu()).toBe(true);
    choice.noteRunningRenderer('wgpu');
    expect(getGpuMaxTextureSize()).toBe(8192);
  });

  it('does not use the adapter\'s limit on a page that runs WebGL', async () => {
    stubAdapter(8192);
    const choice = await import('./renderer-choice');
    const { getGpuMaxTextureSize } = await import('./gpu-limits');
    await choice.canUseWebGpu();
    choice.noteRunningRenderer('webgl');
    // No document here, so there is no WebGL context to probe either.
    expect(getGpuMaxTextureSize()).toBeNull();
  });

  it('falls back to the WebGL probe when the adapter reports no limit', async () => {
    stubAdapter(undefined);
    const choice = await import('./renderer-choice');
    const { getGpuMaxTextureSize } = await import('./gpu-limits');
    await choice.canUseWebGpu();
    choice.noteRunningRenderer('wgpu');
    expect(choice.webGpuTextureLimit()).toBeNull();
    expect(getGpuMaxTextureSize()).toBeNull();
  });
});
