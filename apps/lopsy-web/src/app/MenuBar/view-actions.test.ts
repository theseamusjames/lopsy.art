import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const calls: unknown[][] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push([name, ...args]);
  };
  return {
    calls,
    editor: {
      document: { width: 200, height: 100 },
      viewport: { zoom: 1, width: 0, height: 0 },
      setZoom: record('setZoom'),
      setPan: record('setPan'),
    },
    storeRenderer: vi.fn(),
    runningRenderer: vi.fn<() => 'webgl' | 'wgpu' | null>(() => 'webgl'),
    notifyInfo: vi.fn(),
  };
});

vi.mock('../editor-store', () => ({ useEditorStore: { getState: () => mocks.editor } }));
vi.mock('../../engine-wasm/renderer-choice', () => ({
  storeRenderer: mocks.storeRenderer,
  runningRenderer: mocks.runningRenderer,
}));
vi.mock('../notifications-store', () => ({ notifyInfo: mocks.notifyInfo }));

const { actualSize, chooseRenderer, fitToScreen, zoomStep } = await import('./view-actions');
const { nextZoomLevel } = await import('../../utils/zoom-levels');

beforeEach(() => {
  mocks.calls.length = 0;
  vi.clearAllMocks();
  mocks.editor.viewport = { zoom: 1, width: 0, height: 0 };
});

describe('View menu actions', () => {
  it('zoomStep sets the next zoom level from the store\'s zoom', () => {
    mocks.editor.viewport.zoom = 0.5;
    zoomStep('in');
    zoomStep('out');
    expect(mocks.calls).toEqual([
      ['setZoom', nextZoomLevel(0.5, 'in')],
      ['setZoom', nextZoomLevel(0.5, 'out')],
    ]);
  });

  it('fitToScreen does nothing until the canvas area is measured', () => {
    fitToScreen();
    expect(mocks.calls).toEqual([]);
  });

  it('fitToScreen zooms to 90% of the measured area, then centres', () => {
    mocks.editor.viewport = { zoom: 1, width: 1000, height: 300 };
    fitToScreen();
    expect(mocks.calls).toEqual([['setZoom', 3 * 0.9], ['setPan', 0, 0]]);
  });

  it('actualSize zooms to 1, then centres', () => {
    actualSize();
    expect(mocks.calls).toEqual([['setZoom', 1], ['setPan', 0, 0]]);
  });

  it('chooseRenderer stores the choice, then toasts whether a reload is needed', () => {
    chooseRenderer('webgl');
    chooseRenderer('wgpu');
    expect(mocks.storeRenderer.mock.calls).toEqual([['webgl'], ['wgpu']]);
    expect(mocks.notifyInfo.mock.calls).toEqual([
      ['Lopsy is using the WebGL renderer.'],
      ['Lopsy will use the WebGPU renderer the next time it loads. Reload the page to switch now.'],
    ]);
  });
});
