// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  zoomStep: vi.fn(),
  fitToScreen: vi.fn(),
  actualSize: vi.fn(),
  chooseRenderer: vi.fn(),
  hasWebGpu: vi.fn(() => true),
  runningRenderer: vi.fn<() => 'webgl' | 'wgpu' | null>(() => 'webgl'),
  storedRenderer: vi.fn<() => 'webgl' | 'wgpu' | null>(() => null),
}));

vi.mock('../../app/MenuBar/view-actions', () => ({
  zoomStep: mocks.zoomStep,
  fitToScreen: mocks.fitToScreen,
  actualSize: mocks.actualSize,
  chooseRenderer: mocks.chooseRenderer,
}));
vi.mock('../../engine-wasm/renderer-choice', () => ({
  hasWebGpu: mocks.hasWebGpu,
  runningRenderer: mocks.runningRenderer,
  storedRenderer: mocks.storedRenderer,
}));

const { useUIStore } = await import('../../app/ui-store');
const { getCommand, runCommand } = await import('../registry');
await import('./view');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasWebGpu.mockReturnValue(true);
  mocks.runningRenderer.mockReturnValue('webgl');
  mocks.storedRenderer.mockReturnValue(null);
});

describe('ui.view zoom commands', () => {
  it.each([
    ['ui.view.zoom-in', () => mocks.zoomStep, ['in']],
    ['ui.view.zoom-out', () => mocks.zoomStep, ['out']],
    ['ui.view.fit', () => mocks.fitToScreen, []],
    ['ui.view.actual-size', () => mocks.actualSize, []],
  ] as const)('%s makes its call in the synchronous part', async (id, wrapped, args) => {
    const pending = runCommand(id);
    expect(wrapped().mock.calls).toEqual([args]);
    await expect(pending).resolves.toBeUndefined();
  });
});

describe('ui.view toggles', () => {
  type Flag = 'showRulers' | 'showGrid' | 'showPixelGrid' | 'showGuides' | 'snapToGrid' | 'snapToLayers' | 'snapToGuides' | 'showSeamlessPattern';
  const TOGGLES: ReadonlyArray<readonly [string, Flag]> = [
    ['ui.view.rulers', 'showRulers'],
    ['ui.view.grid', 'showGrid'],
    ['ui.view.pixel-grid', 'showPixelGrid'],
    ['ui.view.guides', 'showGuides'],
    ['ui.view.snap-to-grid', 'snapToGrid'],
    ['ui.view.snap-to-layers', 'snapToLayers'],
    ['ui.view.snap-to-guides', 'snapToGuides'],
    ['ui.view.seamless-pattern', 'showSeamlessPattern'],
  ];

  it.each(TOGGLES)('%s flips %s in the synchronous part, and is checked while it is on', async (id, flag) => {
    const command = getCommand(id)!;
    useUIStore.setState({ [flag]: false });
    expect(command.checked?.({})).toBe(false);
    const pending = runCommand(id);
    expect(useUIStore.getState()[flag]).toBe(true);
    expect(command.checked?.({})).toBe(true);
    await pending;
    await runCommand(id);
    expect(useUIStore.getState()[flag]).toBe(false);
  });

  it('only Snap to Grid records that the user chose it', async () => {
    useUIStore.setState({ hasUserToggledSnapToGrid: false });
    await runCommand('ui.view.snap-to-layers');
    expect(useUIStore.getState().hasUserToggledSnapToGrid).toBe(false);
    await runCommand('ui.view.snap-to-grid');
    expect(useUIStore.getState().hasUserToggledSnapToGrid).toBe(true);
  });
});

describe('ui.view.ruler-unit', () => {
  it('sets the unit and is checked for the current one', async () => {
    useUIStore.setState({ rulerUnit: 'px' });
    await runCommand('ui.view.ruler-unit', { unit: 'mm' });
    expect(useUIStore.getState().rulerUnit).toBe('mm');
    const command = getCommand('ui.view.ruler-unit')!;
    expect(['px', 'pt', 'in', 'mm'].map((unit) => command.checked?.({ unit }))).toEqual([false, false, false, true]);
  });
});

describe('ui.view.renderer', () => {
  it('chooses the renderer in the synchronous part', async () => {
    const pending = runCommand('ui.view.renderer', { renderer: 'wgpu' });
    expect(mocks.chooseRenderer.mock.calls).toEqual([['wgpu']]);
    await pending;
  });

  it('is checked for the stored choice, else the running renderer, else WebGL', () => {
    const command = getCommand('ui.view.renderer')!;
    const checked = (): Array<boolean | undefined> => ['webgl', 'wgpu'].map((renderer) => command.checked?.({ renderer }));
    mocks.storedRenderer.mockReturnValue('wgpu');
    expect(checked()).toEqual([false, true]);
    mocks.storedRenderer.mockReturnValue(null);
    mocks.runningRenderer.mockReturnValue('wgpu');
    expect(checked()).toEqual([false, true]);
    mocks.runningRenderer.mockReturnValue(null);
    expect(checked()).toEqual([true, false]);
  });

  it('disables WebGPU only where the browser has none', () => {
    const command = getCommand('ui.view.renderer')!;
    expect(command.enabled?.({ renderer: 'wgpu' })).toBe(true);
    mocks.hasWebGpu.mockReturnValue(false);
    expect(command.enabled?.({ renderer: 'wgpu' })).toBe(false);
    expect(command.enabled?.({ renderer: 'webgl' })).toBe(true);
  });
});
