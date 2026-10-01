import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PathAnchor } from '../../tools/path/path';

const rasterizePath = vi.fn();
vi.mock('../../tools/path/path', () => ({
  rasterizePath: (...args: unknown[]) => rasterizePath(...args),
}));

vi.mock('../../engine/pixel-data', () => ({
  PixelBuffer: {
    fromImageData: () => ({ toImageData: () => ({}) }),
  },
}));

const guardPixelWrite = vi.fn(() => true);
vi.mock('../../layers/paint-target', () => ({
  guardPixelWrite: (...args: unknown[]) => guardPixelWrite(...(args as [])),
}));

interface MockPath { id: string; anchors: PathAnchor[]; closed: boolean }

const editorState = {
  document: {
    activeLayerId: 'layer-1',
    layers: [{ id: 'layer-1', x: 0, y: 0 }],
  },
  paths: [] as MockPath[],
  selectedPathId: null as string | null,
  pushHistory: vi.fn(),
  pushHistoryMetadata: vi.fn(),
  addPath: vi.fn(),
  getOrCreateLayerPixelData: vi.fn(() => ({})),
  updateLayerPixelData: vi.fn(),
};
vi.mock('../editor-store', () => ({
  useEditorStore: { getState: () => editorState },
}));

const uiState = {
  pathDraft: null as { anchors: PathAnchor[]; closed: boolean } | null,
  clearPath: vi.fn(() => { uiState.pathDraft = null; }),
};
vi.mock('../ui-store', () => ({
  useUIStore: { getState: () => uiState },
}));

const toolSettings = {
  settings: { path: { strokeWidth: 12 } },
  foregroundColor: { r: 200, g: 0, b: 0, a: 1 },
  addRecentColor: vi.fn(),
};
vi.mock('../tool-settings-store', () => ({
  useToolSettingsStore: { getState: () => toolSettings },
}));

import { strokePathOnEnter } from './path-stroke';

function anchor(x: number, y: number): PathAnchor {
  return { point: { x, y }, handleIn: null, handleOut: null };
}

const triangle = [anchor(200, 450), anchor(400, 150), anchor(600, 450)];

describe('strokePathOnEnter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardPixelWrite.mockReturnValue(true);
    uiState.pathDraft = null;
    editorState.paths = [];
    editorState.selectedPathId = null;
  });

  it('commits and strokes an in-progress draft (#976)', () => {
    uiState.pathDraft = { anchors: [...triangle], closed: false };

    strokePathOnEnter();

    expect(editorState.addPath).toHaveBeenCalledWith(triangle, false);
    expect(editorState.pushHistory).toHaveBeenCalledWith('Stroke Path');
    expect(rasterizePath).toHaveBeenCalledWith(expect.anything(), triangle, false, toolSettings.foregroundColor, 12);
  });

  it('strokes the selected closed path when no draft is in progress (#1084)', () => {
    editorState.paths = [{ id: 'p1', anchors: [...triangle], closed: true }];
    editorState.selectedPathId = 'p1';

    strokePathOnEnter();

    expect(editorState.addPath).not.toHaveBeenCalled();
    expect(editorState.pushHistory).toHaveBeenCalledWith('Stroke Path');
    expect(rasterizePath).toHaveBeenCalledWith(expect.anything(), triangle, true, toolSettings.foregroundColor, 12);
  });

  it('strokes the selected path in layer-local coordinates', () => {
    editorState.document.layers = [{ id: 'layer-1', x: 50, y: 20 }];
    editorState.paths = [{ id: 'p1', anchors: [anchor(100, 100), anchor(200, 100)], closed: false }];
    editorState.selectedPathId = 'p1';

    strokePathOnEnter();

    expect(rasterizePath).toHaveBeenCalledWith(
      expect.anything(),
      [anchor(50, 80), anchor(150, 80)],
      false,
      toolSettings.foregroundColor,
      12,
    );
    editorState.document.layers = [{ id: 'layer-1', x: 0, y: 0 }];
  });

  it('does nothing with no draft and no selected path', () => {
    editorState.paths = [{ id: 'p1', anchors: [...triangle], closed: true }];

    strokePathOnEnter();

    expect(editorState.pushHistory).not.toHaveBeenCalled();
    expect(rasterizePath).not.toHaveBeenCalled();
  });

  it('leaves the selected path alone while a one-anchor draft is in progress', () => {
    editorState.paths = [{ id: 'p1', anchors: [...triangle], closed: true }];
    editorState.selectedPathId = 'p1';
    uiState.pathDraft = { anchors: [anchor(10, 10)], closed: false };

    strokePathOnEnter();

    expect(editorState.pushHistory).not.toHaveBeenCalled();
    expect(rasterizePath).not.toHaveBeenCalled();
  });

  it('does not stroke the selected path onto a layer that refuses pixel writes', () => {
    editorState.paths = [{ id: 'p1', anchors: [...triangle], closed: true }];
    editorState.selectedPathId = 'p1';
    guardPixelWrite.mockReturnValue(false);

    strokePathOnEnter();

    expect(editorState.pushHistory).not.toHaveBeenCalled();
    expect(rasterizePath).not.toHaveBeenCalled();
  });
});
