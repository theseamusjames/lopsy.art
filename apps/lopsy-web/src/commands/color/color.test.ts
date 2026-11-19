// @vitest-environment jsdom
import '../../test/canvas-mock';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => null };
});

const { useEditorStore } = await import('../../app/editor-store');
const { useToolSettingsStore } = await import('../../app/tool-settings-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
await import('./color');

function colors() {
  const { foregroundColor, backgroundColor } = useToolSettingsStore.getState();
  return { foregroundColor, backgroundColor };
}

async function failure(promise: Promise<unknown>): Promise<InstanceType<typeof CommandError>> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CommandError);
    return error as InstanceType<typeof CommandError>;
  }
  throw new Error('expected a rejection');
}

beforeEach(() => {
  useEditorStore.getState().createDocument(40, 30, false);
  useEditorStore.getState().pushHistory('New Document');
  useToolSettingsStore.getState().resetColors();
});

function labels(): string[] {
  return useEditorStore.getState().undoStack.map((e) => e.label);
}

describe('color.set', () => {
  it('sets the foreground through setForegroundColor before awaiting, with no history', async () => {
    const spy = vi.spyOn(useToolSettingsStore.getState(), 'setForegroundColor');
    useToolSettingsStore.setState({ setForegroundColor: spy });
    const pending = runCommand('color.set', { foreground: '#ff8000' });
    expect(spy).toHaveBeenCalledWith({ r: 255, g: 128, b: 0, a: 1 });
    expect(await pending).toEqual({ foreground: '#ff8000', background: '#ffffff' });
    expect(labels()).toEqual(['New Document']);
    spy.mockRestore();
  });

  it('sets both, expands #rgb and keeps each colour\'s alpha as the panel does', async () => {
    useToolSettingsStore.getState().setBackgroundColor({ r: 1, g: 2, b: 3, a: 0.5 });
    expect(await runCommand('color.set', { foreground: '#0f0', background: '#102030' })).toEqual({
      foreground: '#00ff00', background: '#10203080',
    });
    expect(colors().backgroundColor).toEqual({ r: 16, g: 32, b: 48, a: 0.5 });
  });

  it('holds the colour to a grayscale document as the panel does', async () => {
    useEditorStore.setState({ document: { ...useEditorStore.getState().document, colorMode: 'grayscale' } });
    await runCommand('color.set', { foreground: '#ff0000' });
    const { r, g, b } = colors().foregroundColor;
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBe(54);
  });

  it('is invalid with no colour, an alpha hex, or a malformed hex', async () => {
    expect((await failure(runCommand('color.set', {}))).message).toBe('color.set: pass foreground, background or both');
    expect((await failure(runCommand('color.set', { foreground: '#ff000080' }))).message).toContain('cannot set alpha');
    expect((await failure(runCommand('color.set', { background: 'red' }))).code).toBe('invalid');
    expect(colors().foregroundColor).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });
});

describe('color.swap and color.reset', () => {
  it('swap calls swapColors, with no history', async () => {
    await runCommand('color.set', { foreground: '#112233' });
    expect(await runCommand('color.swap')).toEqual({ foreground: '#ffffff', background: '#112233' });
    expect(labels()).toEqual(['New Document']);
  });

  it('reset calls resetColors', async () => {
    await runCommand('color.set', { foreground: '#112233', background: '#445566' });
    const spy = vi.fn(useToolSettingsStore.getState().resetColors);
    useToolSettingsStore.setState({ resetColors: spy });
    const pending = runCommand('color.reset');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await pending).toEqual({ foreground: '#000000', background: '#ffffff' });
  });
});
