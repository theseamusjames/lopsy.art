import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RasterLayer, TextLayer, ShapeLayer, GroupLayer, ToolId } from '../types';
import { DEFAULT_EFFECTS } from './layer-model';

vi.mock('../app/notifications-store', () => ({
  notifyInfo: vi.fn(),
  notifyError: vi.fn(),
}));

const { canReceiveRasterPaint, guardPixelWrite, pixelWriteRefusal, toolIgnoresLayerLock, toolWritesRasterPixels } =
  await import('./paint-target');
const { notifyInfo, notifyError } = await import('../app/notifications-store');

const baseRaster: RasterLayer = {
  id: 'raster-1',
  name: 'Layer 1',
  type: 'raster',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  x: 0,
  y: 0,
  clipToBelow: false,
  effects: DEFAULT_EFFECTS,
  mask: null,
  width: 400,
  height: 300,
};

const baseText: TextLayer = {
  id: 'text-1',
  name: 'HELLO',
  type: 'text',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  x: 97,
  y: 233,
  clipToBelow: false,
  effects: DEFAULT_EFFECTS,
  mask: null,
  text: 'HELLO',
  fontFamily: 'Inter',
  fontSize: 32,
  fontWeight: 400,
  fontStyle: 'normal',
  color: { r: 0, g: 0, b: 0, a: 1 },
  lineHeight: 1.2,
  letterSpacing: 0,
  paragraphSpacing: 0,
  textAlign: 'left',
  width: null,
  underline: false,
  strikethrough: false,
};

const baseShape: ShapeLayer = {
  id: 'shape-1',
  name: 'Rect',
  type: 'shape',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  x: 0,
  y: 0,
  clipToBelow: false,
  effects: DEFAULT_EFFECTS,
  mask: null,
  shapeType: 'rectangle',
  fill: { r: 1, g: 0, b: 0, a: 1 },
  stroke: null,
  strokeWidth: 0,
  points: [],
  width: 100,
  height: 100,
  cornerRadius: 0,
};

const baseGroup: GroupLayer = {
  id: 'group-1',
  name: 'Group',
  type: 'group',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  x: 0,
  y: 0,
  clipToBelow: false,
  effects: DEFAULT_EFFECTS,
  mask: null,
  collapsed: false,
  children: [],
  adjustments: [],
  adjustmentsEnabled: true,
};

describe('canReceiveRasterPaint', () => {
  it('true for raster layers', () => {
    expect(canReceiveRasterPaint(baseRaster)).toBe(true);
  });

  it('true for shape layers — shape layers hold their own raster texture', () => {
    expect(canReceiveRasterPaint(baseShape)).toBe(true);
  });

  it('false for group layers', () => {
    expect(canReceiveRasterPaint(baseGroup)).toBe(false);
  });

  it('false for text layers', () => {
    expect(canReceiveRasterPaint(baseText)).toBe(false);
  });

  it('false for null / undefined', () => {
    expect(canReceiveRasterPaint(null)).toBe(false);
    expect(canReceiveRasterPaint(undefined)).toBe(false);
  });
});

describe('guardPixelWrite', () => {
  beforeEach(() => {
    vi.mocked(notifyInfo).mockReset();
  });

  it('true for a raster layer, no notification', () => {
    expect(guardPixelWrite(baseRaster)).toBe(true);
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it('true for a shape layer, no notification', () => {
    expect(guardPixelWrite(baseShape)).toBe(true);
    expect(notifyInfo).not.toHaveBeenCalled();
  });

  it('false for group, with a group-specific notification (#768)', () => {
    expect(guardPixelWrite(baseGroup)).toBe(false);
    expect(notifyInfo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyInfo).mock.calls[0]?.[0]).toMatch(/group/i);
  });

  it('false for text, with a text-specific notification (#768)', () => {
    expect(guardPixelWrite(baseText)).toBe(false);
    expect(notifyInfo).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyInfo).mock.calls[0]?.[0]).toMatch(/text/i);
  });

  it('false for null / undefined with no notification', () => {
    expect(guardPixelWrite(null)).toBe(false);
    expect(guardPixelWrite(undefined)).toBe(false);
    expect(notifyInfo).not.toHaveBeenCalled();
  });
});

const GROUP_REASON = "Groups can't be painted on. Select a layer inside the group.";
const TEXT_REASON = 'Text layers must be rasterized before they can be painted on.';

describe('pixelWriteRefusal', () => {
  beforeEach(() => {
    vi.mocked(notifyInfo).mockReset();
    vi.mocked(notifyError).mockReset();
  });

  it('null for raster and shape layers', () => {
    expect(pixelWriteRefusal(baseRaster)).toBeNull();
    expect(pixelWriteRefusal(baseShape)).toBeNull();
  });

  it('pins the group and text toasts', () => {
    expect(pixelWriteRefusal(baseGroup)).toEqual({ reason: GROUP_REASON, notice: 'info' });
    expect(pixelWriteRefusal(baseText)).toEqual({ reason: TEXT_REASON, notice: 'info' });
  });

  it('a silent refusal with a reason when there is no layer', () => {
    expect(pixelWriteRefusal(null)).toEqual({ reason: 'There is no active layer.', notice: null });
    expect(pixelWriteRefusal(undefined)).toEqual({ reason: 'There is no active layer.', notice: null });
  });

  it('agrees with canReceiveRasterPaint', () => {
    for (const layer of [baseRaster, baseShape, baseGroup, baseText, null, undefined]) {
      expect(pixelWriteRefusal(layer) === null).toBe(canReceiveRasterPaint(layer));
    }
  });

  it('has no side effects', () => {
    for (const layer of [baseRaster, baseGroup, baseText, null]) pixelWriteRefusal(layer);
    expect(notifyInfo).not.toHaveBeenCalled();
    expect(notifyError).not.toHaveBeenCalled();
  });

  it('guardPixelWrite toasts exactly those strings once', () => {
    expect(guardPixelWrite(baseGroup)).toBe(false);
    expect(notifyInfo).toHaveBeenCalledTimes(1);
    expect(notifyInfo).toHaveBeenLastCalledWith(GROUP_REASON);
    expect(guardPixelWrite(baseText)).toBe(false);
    expect(notifyInfo).toHaveBeenCalledTimes(2);
    expect(notifyInfo).toHaveBeenLastCalledWith(TEXT_REASON);
    expect(notifyError).not.toHaveBeenCalled();
  });
});

describe('toolWritesRasterPixels', () => {
  it('true for the paint tools', () => {
    const PAINT: ToolId[] = ['brush', 'pencil', 'eraser', 'spray', 'stamp', 'healing', 'dodge', 'sponge', 'smudge'];
    for (const t of PAINT) {
      expect(toolWritesRasterPixels(t), t).toBe(true);
    }
  });

  it('true for fill, gradient, shape (non-paint writers)', () => {
    expect(toolWritesRasterPixels('fill')).toBe(true);
    expect(toolWritesRasterPixels('gradient')).toBe(true);
    expect(toolWritesRasterPixels('shape')).toBe(true);
    expect(toolWritesRasterPixels('shape', { shapeOutput: 'pixels' })).toBe(true);
  });

  it('false for the shape tool with path output (#1262)', () => {
    expect(toolWritesRasterPixels('shape', { shapeOutput: 'path' })).toBe(false);
    expect(toolWritesRasterPixels('brush', { shapeOutput: 'path' })).toBe(true);
  });

  it('false for non-writer tools', () => {
    const NON_WRITERS: ToolId[] = [
      'move', 'eyedropper', 'text', 'crop', 'path',
      'marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-magnetic', 'wand', 'quick-select',
    ];
    for (const t of NON_WRITERS) {
      expect(toolWritesRasterPixels(t), t).toBe(false);
    }
  });
});

describe('toolIgnoresLayerLock', () => {
  it('true for selection tools and the eyedropper (#1188)', () => {
    const EXEMPT: ToolId[] = [
      'marquee-rect', 'marquee-ellipse', 'lasso', 'lasso-magnetic', 'wand', 'quick-select', 'eyedropper',
    ];
    for (const t of EXEMPT) {
      expect(toolIgnoresLayerLock(t), t).toBe(true);
    }
  });

  it('false for tools that write or move the layer', () => {
    const GUARDED: ToolId[] = ['move', 'brush', 'eraser', 'fill', 'gradient', 'shape', 'text', 'crop', 'path', 'stamp'];
    for (const t of GUARDED) {
      expect(toolIgnoresLayerLock(t), t).toBe(false);
    }
  });
});
