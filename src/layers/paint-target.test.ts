import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RasterLayer, TextLayer, ShapeLayer, GroupLayer, ToolId } from '../types';
import { DEFAULT_EFFECTS } from './layer-model';

vi.mock('../app/notifications-store', () => ({
  notifyInfo: vi.fn(),
}));

const { canReceiveRasterPaint, guardPixelWrite, toolWritesRasterPixels } =
  await import('./paint-target');
const { notifyInfo } = await import('../app/notifications-store');

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
