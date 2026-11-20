// @vitest-environment jsdom
import '../../../test/canvas-mock';
import { beforeEach, describe, expect, it } from 'vitest';

const { getMenus } = await import('./index');
const { getCommand } = await import('../../../commands/registry');
const { validateParams } = await import('../../../commands/params');
const { useEditorStore } = await import('../../editor-store');
const { useUIStore } = await import('../../ui-store');
const { canMergeDown } = await import('../../store/actions/merge-down');
const { createRectSelection } = await import('../../../selection/selection');
type MenuItem = import('./types').MenuItem;

interface Leaf {
  path: string;
  item: MenuItem;
}

function leaves(): Leaf[] {
  const out: Leaf[] = [];
  const walk = (prefix: string, items: readonly MenuItem[]): void => {
    for (const item of items) {
      if (item.separator) continue;
      if (item.submenu) walk(`${prefix} > ${item.label}`, item.submenu);
      else out.push({ path: `${prefix} > ${item.label}`, item });
    }
  };
  for (const menu of getMenus()) walk(menu.label, menu.items);
  return out;
}

function leaf(path: string): MenuItem {
  const found = leaves().find((l) => l.path === path);
  if (!found) throw new Error(`no menu item ${path}`);
  return found.item;
}

function selectRect(): void {
  const { width, height } = useEditorStore.getState().document;
  const rect = { x: 10, y: 10, width: 20, height: 20 };
  useEditorStore.getState().setSelection(rect, createRectSelection(rect, width, height), width, height);
}

/** The menu items bound to a document command, which runs exactly what the item ran before the commands. */
const DOCUMENT_BINDINGS: Record<string, { id: string; params?: Record<string, unknown> }> = {
  'Edit > Undo': { id: 'history.undo' },
  'Edit > Redo': { id: 'history.redo' },
  'Edit > Fill': { id: 'paint.fill' },
  'Edit > Clear Guides': { id: 'guide.clear' },
  'Image > Mode > RGB Color': { id: 'doc.color-mode', params: { mode: 'rgb' } },
  'Image > Mode > Grayscale': { id: 'doc.color-mode', params: { mode: 'grayscale' } },
  'Image > Mode > CMYK Color': { id: 'doc.color-mode', params: { mode: 'cmyk' } },
  'Image > Mode > Lab Color': { id: 'doc.color-mode', params: { mode: 'lab' } },
  'Layer > New Layer': { id: 'layer.add' },
  'Select > Inverse': { id: 'select.invert' },
  'Edit > Cut': { id: 'clipboard.cut' },
  'Edit > Copy': { id: 'clipboard.copy' },
  'Edit > Copy Merged': { id: 'clipboard.copy-merged' },
  'Edit > Paste': { id: 'clipboard.paste' },
  'Edit > Crop': { id: 'image.crop-to-selection' },
  'Edit > Define Pattern': { id: 'pattern.define' },
  'Image > Auto Tone': { id: 'image.auto', params: { kind: 'tone' } },
  'Image > Auto Contrast': { id: 'image.auto', params: { kind: 'contrast' } },
  'Image > Auto Color': { id: 'image.auto', params: { kind: 'color' } },
  'Image > Rotate 90° CW': { id: 'image.rotate', params: { direction: 'cw' } },
  'Image > Rotate 90° CCW': { id: 'image.rotate', params: { direction: 'ccw' } },
  'Image > Flip Horizontal': { id: 'image.flip-layer', params: { axis: 'horizontal' } },
  'Image > Flip Vertical': { id: 'image.flip-layer', params: { axis: 'vertical' } },
  'Layer > Group Layers': { id: 'layer.group' },
  'Layer > Merge Down': { id: 'layer.merge-down' },
  'Layer > Flatten Image': { id: 'layer.flatten' },
  'Select > All': { id: 'select.all' },
  'Select > Deselect': { id: 'select.none' },
  'Select > Selection → Path': { id: 'select.to-path' },
  'Filter > Find Edges': { id: 'filter.find-edges' },
  'Filter > Invert': { id: 'filter.invert' },
  'Filter > Desaturate': { id: 'filter.desaturate' },
  'Path > Unite Paths': { id: 'path.unite' },
  'Path > Subtract Paths': { id: 'path.subtract' },
  'Path > Intersect Paths': { id: 'path.intersect' },
  'Path > Exclude Paths': { id: 'path.exclude' },
};

/** Before the commands, these items and only these computed `disabled`. */
const DISABLEABLE = [
  'Edit > Crop', 'Edit > Define Brush...', 'Edit > Define Color Brush...',
  'Layer > Merge Down', 'Select > Selection → Path',
  'Filter > Liquify...', 'Filter > Tilt-Shift Blur...',
  'View > Renderer > WebGL', 'View > Renderer > WebGPU (Experimental)',
];

/** Before the commands, these items and only these computed `checked`. */
const CHECKABLE = [
  'Image > Mode > RGB Color', 'Image > Mode > Grayscale', 'Image > Mode > Indexed Color...',
  'Image > Mode > CMYK Color', 'Image > Mode > Lab Color',
  'View > Show Rulers', 'View > Units > Pixels', 'View > Units > Points', 'View > Units > Inches',
  'View > Units > Millimeters', 'View > Show Grid', 'View > Show Pixel Grid', 'View > Show Guides',
  'View > Snap to Grid', 'View > Snap to Layers', 'View > Snap to Guides', 'View > Show Seamless Pattern',
  'View > Renderer > WebGL', 'View > Renderer > WebGPU (Experimental)',
];

beforeEach(() => {
  useEditorStore.getState().createDocument(200, 150, false);
  useUIStore.setState({ maskMode: 'off' });
});

describe('menu structure', () => {
  it('has the 107 leaf items of the nine menus', () => {
    expect(getMenus().map((menu) => menu.label)).toEqual(['File', 'Edit', 'Image', 'Layer', 'Select', 'Filter', 'Path', 'View', 'Help']);
    expect(leaves()).toHaveLength(107);
  });

  it('gives every leaf a registered command and no action', () => {
    for (const { path, item } of leaves()) {
      expect(item.action, path).toBeUndefined();
      expect(item.command, path).toBeDefined();
      expect(getCommand(item.command!.id), `${path} runs ${item.command!.id}`).toBeDefined();
      expect(() => validateParams(item.command!.id, getCommand(item.command!.id)!.params, item.command!.params), path).not.toThrow();
    }
  });

  it('binds document commands only where they run what the item ran, and ui.* commands elsewhere', () => {
    for (const { path, item } of leaves()) {
      const expected = DOCUMENT_BINDINGS[path];
      if (expected) {
        expect(item.command, path).toEqual(expected.params ? expected : { id: expected.id });
      } else {
        expect(item.command!.id, path).toMatch(/^ui\./);
      }
    }
    for (const path of Object.keys(DOCUMENT_BINDINGS)) expect(leaf(path).command).toBeDefined();
  });

  it('reads disabled and checked from the bound command\'s enabled() and checked(), and only where the menu computed them', () => {
    for (const { path, item } of leaves()) {
      const command = getCommand(item.command!.id)!;
      const params = validateParams(command.id, command.params, item.command!.params);
      expect(item.disabled, path).toBe(command.enabled ? !command.enabled(params) : undefined);
      expect(item.checked, path).toBe(command.checked ? command.checked(params) : undefined);
      expect(item.disabled !== undefined, `${path} disableable`).toBe(DISABLEABLE.includes(path));
      expect(item.checked !== undefined, `${path} checkable`).toBe(CHECKABLE.includes(path));
    }
  });
});

describe('menu state, read as the menu is built', () => {
  it('disables Crop, Define Brush..., Define Color Brush... and Selection → Path without a selection', () => {
    const selectionItems = ['Edit > Crop', 'Edit > Define Brush...', 'Edit > Define Color Brush...', 'Select > Selection → Path'];
    expect(selectionItems.map((path) => leaf(path).disabled)).toEqual([true, true, true, true]);
    selectRect();
    expect(selectionItems.map((path) => leaf(path).disabled)).toEqual([false, false, false, false]);
  });

  it('disables Merge Down as canMergeDown says, and never disables Duplicate Layer or Group Layers (D7, D8)', () => {
    const doc = useEditorStore.getState().document;
    expect(leaf('Layer > Merge Down').disabled).toBe(!canMergeDown(doc));
    useEditorStore.getState().addLayer();
    expect(canMergeDown(useEditorStore.getState().document)).toBe(true);
    expect(leaf('Layer > Merge Down').disabled).toBe(false);
    useEditorStore.getState().setActiveLayer(useEditorStore.getState().document.rootGroupId!);
    expect(leaf('Layer > Duplicate Layer').disabled).toBeUndefined();
    expect(leaf('Layer > Group Layers').disabled).toBeUndefined();
  });

  it('never disables Undo and Redo (D18)', () => {
    useEditorStore.setState({ undoStack: [], redoStack: [] });
    expect(leaf('Edit > Undo').disabled).toBeUndefined();
    expect(leaf('Edit > Redo').disabled).toBeUndefined();
  });

  it('disables Liquify and Tilt-Shift only while filters target a layer mask', () => {
    expect([leaf('Filter > Liquify...').disabled, leaf('Filter > Tilt-Shift Blur...').disabled]).toEqual([false, false]);
    const active = useEditorStore.getState().document.activeLayerId!;
    useEditorStore.getState().addLayerMask(active);
    useUIStore.setState({ maskMode: 'layerMask' });
    expect([leaf('Filter > Liquify...').disabled, leaf('Filter > Tilt-Shift Blur...').disabled]).toEqual([true, true]);
  });

  it('checks the document\'s colour mode in Image > Mode', () => {
    const mode = getMenus()[2]!.items[0]!.submenu!;
    expect(mode.map((item) => [item.label, item.checked])).toEqual([
      ['RGB Color', true], ['Grayscale', false], ['Indexed Color...', false], ['CMYK Color', false], ['Lab Color', false],
    ]);
    expect(mode.map((item) => item.command)).toEqual([
      { id: 'doc.color-mode', params: { mode: 'rgb' } },
      { id: 'doc.color-mode', params: { mode: 'grayscale' } },
      { id: 'ui.image.indexed-color' },
      { id: 'doc.color-mode', params: { mode: 'cmyk' } },
      { id: 'doc.color-mode', params: { mode: 'lab' } },
    ]);
    useEditorStore.setState({ document: { ...useEditorStore.getState().document, colorMode: 'indexed' } });
    expect(getMenus()[2]!.items[0]!.submenu!.map((item) => item.checked)).toEqual([false, false, true, false, false]);
  });

  it('checks the View toggles from the UI store', () => {
    useUIStore.setState({ showRulers: true, showGrid: false, snapToGuides: true });
    expect(leaf('View > Show Rulers').checked).toBe(true);
    expect(leaf('View > Show Grid').checked).toBe(false);
    expect(leaf('View > Snap to Guides').checked).toBe(true);
  });

  it('keeps the shortcut labels', () => {
    const shortcuts = Object.fromEntries(leaves().filter((l) => l.item.shortcut).map((l) => [l.path, l.item.shortcut]));
    expect(shortcuts).toEqual({
      'File > New': '⌘N', 'File > Open...': '⌘O', 'File > Save Project': '⌘S',
      'File > Export…': '⌥⇧⌘E', 'File > Quick Export PNG': '⇧⌘E',
      'Edit > Undo': '⌘Z', 'Edit > Redo': '⇧⌘Z', 'Edit > Cut': '⌘X', 'Edit > Copy': '⌘C',
      'Edit > Copy Merged': '⇧⌘C', 'Edit > Paste': '⌘V', 'Edit > Fill': '⇧F5',
      'Image > Auto Tone': '⇧⌘L', 'Image > Auto Contrast': '⌥⇧⌘L', 'Image > Auto Color': '⇧⌘B',
      'Layer > New Layer': '⇧⌘N', 'Layer > Duplicate Layer': '⌘J', 'Layer > Group Layers': '⌘G',
      'Layer > Merge Down': '⌘E',
      'Select > All': '⌘A', 'Select > Deselect': '⌘D', 'Select > Inverse': '⇧⌘I',
      'Filter > Liquify...': '⌘⇧X',
      'View > Zoom In': '⌘=', 'View > Zoom Out': '⌘-', 'View > Fit to Screen': '⌘0',
      'View > Actual Size': '⌘1', 'View > Show Rulers': '⌘R', 'View > Show Grid': "⌘'",
      'View > Show Guides': '⌘;',
    });
  });
});
