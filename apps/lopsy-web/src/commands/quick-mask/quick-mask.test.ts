// @vitest-environment jsdom
import '../../test/canvas-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

const mocks = vi.hoisted(() => ({
  enterQuickMaskMode: vi.fn(),
  exitQuickMaskMode: vi.fn(),
}));

vi.mock('../../app/interactions/quick-mask-ops', () => ({
  enterQuickMaskMode: mocks.enterQuickMaskMode,
  exitQuickMaskMode: mocks.exitQuickMaskMode,
}));

const { useEditorStore } = await import('../../app/editor-store');
const { useUIStore } = await import('../../app/ui-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./quick-mask');

const BOUNDS = { x: 5, y: 6, width: 10, height: 12 };

beforeEach(() => {
  useEditorStore.getState().createDocument(40, 30, false);
  useUIStore.setState({ maskMode: 'off' });
  mocks.enterQuickMaskMode.mockImplementation(() => useUIStore.setState({ maskMode: 'quickMask' }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('quickmask.set', () => {
  it('enters through enterQuickMaskMode in the synchronous part', async () => {
    const pending = runCommand('quickmask.set', { enabled: true });
    expect(mocks.enterQuickMaskMode).toHaveBeenCalledTimes(1);
    expect(await pending).toEqual({ enabled: true, selection: { active: false, bounds: null } });
  });

  it('leaves through exitQuickMaskMode, started in the synchronous part, and reports the selection it installs', async () => {
    useUIStore.setState({ maskMode: 'quickMask' });
    let install: () => void = () => undefined;
    mocks.exitQuickMaskMode.mockImplementation(() => {
      useUIStore.setState({ maskMode: 'off' });
      return new Promise<void>((resolve) => {
        install = () => {
          useEditorStore.setState({ selection: { active: true, bounds: BOUNDS, mask: Uint8ClampedArray.from({ length: 1200 }), maskWidth: 40, maskHeight: 30 } });
          resolve();
        };
      });
    });
    const pending = runCommand('quickmask.set', { enabled: false });
    expect(mocks.exitQuickMaskMode).toHaveBeenCalledTimes(1);
    install();
    expect(await pending).toEqual({ enabled: false, selection: { active: true, bounds: BOUNDS } });
  });

  it('does nothing when Quick Mask is already in that state', async () => {
    expect(await runCommand('quickmask.set', { enabled: false })).toMatchObject({ enabled: false });
    useUIStore.setState({ maskMode: 'quickMask' });
    expect(await runCommand('quickmask.set', { enabled: true })).toMatchObject({ enabled: true });
    expect(mocks.enterQuickMaskMode).not.toHaveBeenCalled();
    expect(mocks.exitQuickMaskMode).not.toHaveBeenCalled();
  });

  it('enters from layer-mask edit mode, as the Q key does', async () => {
    useUIStore.setState({ maskMode: 'layerMask' });
    await runCommand('quickmask.set', { enabled: true });
    expect(mocks.enterQuickMaskMode).toHaveBeenCalledTimes(1);
  });

  it('needs a document and an enabled flag', async () => {
    await expect(runCommand('quickmask.set', {})).rejects.toBeInstanceOf(CommandError);
    useEditorStore.setState({ documentReady: false });
    await expect(runCommand('quickmask.set', { enabled: true })).rejects.toMatchObject({ code: 'unavailable' });
    useEditorStore.setState({ documentReady: true });
    expect(mocks.enterQuickMaskMode).not.toHaveBeenCalled();
  });
});
