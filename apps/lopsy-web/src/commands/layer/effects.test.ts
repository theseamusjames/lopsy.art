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

vi.mock('../../engine-wasm/engine-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../engine-wasm/engine-state')>();
  return { ...actual, getEngine: () => null };
});

const { useEditorStore } = await import('../../app/editor-store');
const { CommandError } = await import('../command');
const { runCommand } = await import('../registry');
const { DEFAULT_EFFECTS } = await import('../../layers/layer-model');
await import('./effects');

type Store = ReturnType<typeof useEditorStore.getState>;
const realUpdate = useEditorStore.getState().updateLayerEffects;

function store(): Store {
  return useEditorStore.getState();
}

function layerNamed(name: string) {
  const layer = store().document.layers.find((l) => l.name === name);
  if (!layer) throw new Error(`no layer ${name}`);
  return layer;
}

function labels(): string[] {
  return store().undoStack.map((e) => e.label);
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
  store().createDocument(40, 30, false);
  store().pushHistory('New Document');
});

afterEach(() => {
  useEditorStore.setState({ updateLayerEffects: realUpdate });
  vi.restoreAllMocks();
});

describe('layer.effects', () => {
  it('calls updateLayerEffects with skipHistory before its first await, one call per changed control', async () => {
    const update = vi.fn(realUpdate);
    useEditorStore.setState({ updateLayerEffects: update });
    const id = layerNamed('Layer 1').id;
    const pending = runCommand('layer.effects', { dropShadow: { enabled: true, blur: 12 } });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0]).toEqual([id, { dropShadow: { ...DEFAULT_EFFECTS.dropShadow, enabled: true } }, true]);
    expect(update.mock.calls[1]?.[2]).toBe(true);
    await pending;
  });

  it('pushes the history the drawer pushes, one entry per changed control in the drawer\'s order', async () => {
    await runCommand('layer.effects', {
      stroke: { width: 5, enabled: true, position: 'inside', color: '#00ff00' },
      dropShadow: { opacity: 50 },
    });
    expect(labels()).toEqual([
      'New Document',
      'Edit Drop Shadow',
      'Enable Stroke',
      'Edit Stroke',
      'Edit Stroke',
    ]);
    const { stroke, dropShadow } = layerNamed('Layer 1').effects;
    expect(stroke).toEqual({ enabled: true, color: { r: 0, g: 255, b: 0, a: 1 }, width: 5, position: 'inside' });
    expect(dropShadow.opacity).toBe(0.5);
  });

  it('labels a turned-off checkbox "Disable" and skips unchanged values', async () => {
    await runCommand('layer.effects', { outerGlow: { enabled: true } });
    await runCommand('layer.effects', { outerGlow: { enabled: false, size: 10, color: '#ffff64' } });
    expect(labels()).toEqual(['New Document', 'Enable Outer Glow', 'Disable Outer Glow']);
  });

  it('returns the full effects in the drawer\'s units and keeps fields not mentioned', async () => {
    const result = await runCommand('layer.effects', { colorOverlay: { enabled: true, color: '#123' } });
    expect(result).toEqual({
      dropShadow: { enabled: false, color: '#000000', offsetX: 4, offsetY: 4, blur: 8, spread: 0, opacity: 75 },
      stroke: { enabled: false, color: '#000000', width: 2, position: 'outside' },
      outerGlow: { enabled: false, color: '#ffff64', size: 10, spread: 0, opacity: 75 },
      innerGlow: { enabled: false, color: '#ffff64', size: 10, spread: 0, opacity: 75 },
      colorOverlay: { enabled: true, color: '#112233' },
    });
  });

  it('keeps the colour\'s alpha, as the drawer\'s picker does', async () => {
    const id = layerNamed('Layer 1').id;
    realUpdate(id, { innerGlow: { ...DEFAULT_EFFECTS.innerGlow, color: { r: 1, g: 2, b: 3, a: 0.5 } } }, true);
    await runCommand('layer.effects', { innerGlow: { color: '#ff0000' } });
    expect(layerNamed('Layer 1').effects.innerGlow.color).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });

  it('acts on a named layer without making it active', async () => {
    const active = store().document.activeLayerId;
    await runCommand('layer.effects', { layer: 'Background', stroke: { enabled: true } });
    expect(layerNamed('Background').effects.stroke.enabled).toBe(true);
    expect(store().document.activeLayerId).toBe(active);
  });

  it('refuses a group', async () => {
    const error = await failure(runCommand('layer.effects', { layer: 'Project', stroke: { enabled: true } }));
    expect(error.code).toBe('refused');
    expect(error.message).toBe('"Project" is a group: groups have no layer effects (their effects button opens the Adjustments drawer).');
    expect(labels()).toEqual(['New Document']);
  });

  it('rejects an empty patch, an alpha colour and values outside the document-scaled ranges', async () => {
    expect((await failure(runCommand('layer.effects', {}))).message).toBe(
      'layer.effects: pass at least one of dropShadow, stroke, outerGlow, innerGlow, colorOverlay',
    );
    expect((await failure(runCommand('layer.effects', { stroke: { color: '#ff000080' } }))).message).toBe(
      'layer.effects: stroke.color must be "#rrggbb": the drawer\'s colour picker cannot set alpha',
    );
    expect((await failure(runCommand('layer.effects', { dropShadow: { offsetX: -101 } }))).message).toBe(
      'layer.effects: dropShadow.offsetX must be from -100 to 100 in this document, got -101',
    );
    expect((await failure(runCommand('layer.effects', { stroke: { width: 61 } }))).message).toBe(
      'layer.effects: stroke.width must be from 1 to 60 in this document, got 61',
    );
    expect((await failure(runCommand('layer.effects', { innerGlow: { opacity: 101 } }))).code).toBe('invalid');
    expect((await failure(runCommand('layer.effects', { stroke: { position: 'middle' } }))).code).toBe('invalid');
    expect(labels()).toEqual(['New Document']);
  });

  it('checks every range before changing anything', async () => {
    await failure(runCommand('layer.effects', { dropShadow: { enabled: true }, stroke: { width: 0 } }));
    expect(layerNamed('Layer 1').effects.dropShadow.enabled).toBe(false);
  });

  it('reports a missing layer as not-found', async () => {
    expect((await failure(runCommand('layer.effects', { layer: 'Nope', stroke: { enabled: true } }))).code).toBe('not-found');
  });
});
