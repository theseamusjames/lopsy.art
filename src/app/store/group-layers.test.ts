// @vitest-environment jsdom
import '../../test/canvas-mock';
import { describe, it, expect, beforeEach } from 'vitest';

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

const { useEditorStore } = await import('../editor-store');
import { buildFlatDisplayList, isGroupLayer } from '../../layers/group-utils';

function state() {
  return useEditorStore.getState();
}

function panelTopToBottom(): string[] {
  const doc = state().document;
  return buildFlatDisplayList(doc.layers, doc.layerOrder).map((e) => e.layer.name);
}

function addNamedLayer(name: string): string {
  state().addLayer();
  const id = state().document.activeLayerId!;
  state().renameLayer(id, name);
  return id;
}

describe('groupSelectedLayers (#784)', () => {
  beforeEach(() => {
    state().createDocument(400, 300, false);
  });

  it('preserves top→bottom stacking order of the grouped layers', () => {
    // Panel top→bottom before grouping: B, A, Layer 1, Background.
    const a = addNamedLayer('A');
    const b = addNamedLayer('B');
    state().setLayerSelection([a, b]);
    state().groupSelectedLayers();

    // The new group is now active; find it and inspect its children.
    const doc = state().document;
    const group = doc.layers.find((l) => l.id === doc.activeLayerId!);
    expect(group && isGroupLayer(group)).toBe(true);
    // children[] is bottom→top; panel shows top→bottom. Expected order in
    // the panel: B on top, A below.
    const childNames = (group as { children: readonly string[] }).children
      .slice()
      .reverse()
      .map((cid) => doc.layers.find((l) => l.id === cid)!.name);
    expect(childNames).toEqual(['B', 'A']);
  });

  it('keeps the new group where the topmost selected layer was — not at the top of the parent stack', () => {
    // Build panel top→bottom: D, C, B, A, Layer 1, Background.
    addNamedLayer('A');
    addNamedLayer('B');
    const c = addNamedLayer('C');
    const d = addNamedLayer('D');

    // Group D + C only — group should stay where D+C were, above B/A/Layer 1.
    state().setLayerSelection([c, d]);
    state().groupSelectedLayers();

    const doc = state().document;
    const groupId = doc.activeLayerId!;
    const group = doc.layers.find((l) => l.id === groupId)!;
    expect(isGroupLayer(group)).toBe(true);

    // Panel top→bottom now: root group, then Group(D, C), then B, A,
    // Layer 1, Background.
    const panel = panelTopToBottom();
    const rootName = state().document.layers.find((l) => l.id === state().document.rootGroupId)!.name;
    expect(panel).toEqual([rootName, group.name, 'D', 'C', 'B', 'A', 'Layer 1', 'Background']);
  });

  it('groups two contiguous layers without hoisting the group above unrelated siblings', () => {
    // Layers created oldest-first: Background, Layer 1, X, Y, Z, W.
    // Panel top→bottom: W, Z, Y, X, Layer 1, Background.
    addNamedLayer('X');
    const y = addNamedLayer('Y');
    const z = addNamedLayer('Z');
    addNamedLayer('W');

    state().setLayerSelection([y, z]);
    state().groupSelectedLayers();

    const doc = state().document;
    const groupName = doc.layers.find((l) => l.id === doc.activeLayerId!)!.name;
    const rootName = doc.layers.find((l) => l.id === doc.rootGroupId)!.name;
    // Expected panel top→bottom: root, W, Group(Z, Y), X, Layer 1, Background.
    expect(panelTopToBottom()).toEqual([
      rootName,
      'W',
      groupName,
      'Z',
      'Y',
      'X',
      'Layer 1',
      'Background',
    ]);
  });
});
