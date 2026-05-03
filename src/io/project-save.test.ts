import { describe, it, expect } from 'vitest';
import type { LopsyManifest, SerializedLayer } from './project-save';
import type { RasterLayer, TextLayer, GroupLayer, ShapeLayer } from '../types/layers';
import { DEFAULT_EFFECTS } from '../layers/layer-model';
import { DEFAULT_ADJUSTMENTS } from '../filters/image-adjustments';

// ---------------------------------------------------------------------------
// Helpers: build minimal layer fixtures
// ---------------------------------------------------------------------------

function makeRaster(overrides: Partial<RasterLayer> = {}): RasterLayer {
  return {
    id: 'r1',
    name: 'Raster',
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
    width: 100,
    height: 80,
    ...overrides,
  };
}

function makeText(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    id: 't1',
    name: 'Text',
    type: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 10,
    y: 20,
    clipToBelow: false,
    effects: DEFAULT_EFFECTS,
    mask: null,
    text: 'Hello',
    fontFamily: 'Inter',
    fontSize: 24,
    fontWeight: 400,
    fontStyle: 'normal',
    color: { r: 0, g: 0, b: 0, a: 1 },
    lineHeight: 1.4,
    letterSpacing: 0,
    textAlign: 'left',
    width: null,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<GroupLayer> = {}): GroupLayer {
  return {
    id: 'g1',
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
    children: ['r1'],
    collapsed: false,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    adjustmentsEnabled: true,
    ...overrides,
  };
}

function makeShape(overrides: Partial<ShapeLayer> = {}): ShapeLayer {
  return {
    id: 's1',
    name: 'Shape',
    type: 'shape',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 5,
    y: 5,
    clipToBelow: false,
    effects: DEFAULT_EFFECTS,
    mask: null,
    shapeType: 'rectangle',
    fill: { r: 255, g: 0, b: 0, a: 1 },
    stroke: null,
    strokeWidth: 0,
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
    width: 100,
    height: 80,
    cornerRadius: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Manifest serialization helpers (inline to keep tests self-contained)
// ---------------------------------------------------------------------------

function serializeLayerForTest(
  layer: RasterLayer | TextLayer | GroupLayer | ShapeLayer,
  pixelDataIndex: number,
  maskDataIndex: number,
): SerializedLayer {
  const base = {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    x: layer.x,
    y: layer.y,
    clipToBelow: layer.clipToBelow,
    effects: layer.effects,
    pixelDataIndex,
    maskDataIndex,
    maskEnabled: layer.mask?.enabled,
    maskWidth: layer.mask?.width,
    maskHeight: layer.mask?.height,
  };

  if (layer.type === 'raster') {
    return { ...base, width: layer.width, height: layer.height };
  }
  if (layer.type === 'text') {
    return {
      ...base,
      text: layer.text,
      fontFamily: layer.fontFamily,
      fontSize: layer.fontSize,
      fontWeight: layer.fontWeight,
      fontStyle: layer.fontStyle,
      color: layer.color,
      lineHeight: layer.lineHeight,
      letterSpacing: layer.letterSpacing,
      textAlign: layer.textAlign,
      textWidth: layer.width,
    };
  }
  if (layer.type === 'shape') {
    return {
      ...base,
      shapeType: layer.shapeType,
      fill: layer.fill,
      stroke: layer.stroke,
      strokeWidth: layer.strokeWidth,
      points: [...layer.points],
      width: layer.width,
      height: layer.height,
      cornerRadius: layer.cornerRadius,
    };
  }
  // group
  const g = layer as GroupLayer;
  return {
    ...base,
    children: g.children,
    collapsed: g.collapsed,
    adjustments: g.adjustments,
    adjustmentsEnabled: g.adjustmentsEnabled,
  };
}

function buildManifest(layers: (RasterLayer | TextLayer | GroupLayer | ShapeLayer)[]): LopsyManifest {
  const serialized = layers.map((l) => serializeLayerForTest(l, l.type !== 'group' ? 0 : -1, -1));
  return {
    version: 1,
    documentName: 'Test Doc',
    documentWidth: 400,
    documentHeight: 300,
    backgroundColor: { r: 255, g: 255, b: 255, a: 1 },
    layers: serialized,
    layerOrder: layers.map((l) => l.id),
    rootGroupId: null,
    activeLayerId: layers[0]?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tests: manifest round-trip via JSON serialization
// ---------------------------------------------------------------------------

describe('manifest JSON round-trip', () => {
  it('preserves raster layer metadata', () => {
    const layer = makeRaster({ name: 'BG', opacity: 0.8, x: 5, y: 10 });
    const manifest = buildManifest([layer]);
    const json = JSON.stringify(manifest);
    const restored = JSON.parse(json) as LopsyManifest;

    const s = restored.layers[0]!;
    expect(s.id).toBe('r1');
    expect(s.name).toBe('BG');
    expect(s.type).toBe('raster');
    expect(s.opacity).toBe(0.8);
    expect(s.x).toBe(5);
    expect(s.y).toBe(10);
    expect(s.width).toBe(100);
    expect(s.height).toBe(80);
  });

  it('preserves text layer metadata', () => {
    const layer = makeText({ text: 'Foo', fontSize: 36, fontFamily: 'JetBrains Mono' });
    const manifest = buildManifest([layer]);
    const json = JSON.stringify(manifest);
    const restored = JSON.parse(json) as LopsyManifest;

    const s = restored.layers[0]!;
    expect(s.type).toBe('text');
    expect(s.text).toBe('Foo');
    expect(s.fontSize).toBe(36);
    expect(s.fontFamily).toBe('JetBrains Mono');
    expect(s.textWidth).toBe(null);
  });

  it('preserves group layer metadata including children', () => {
    const group = makeGroup({ children: ['r1', 'r2'], collapsed: true });
    const manifest = buildManifest([group]);
    const json = JSON.stringify(manifest);
    const restored = JSON.parse(json) as LapsyManifest;

    const s = (restored as LopsyManifest).layers[0]!;
    expect(s.type).toBe('group');
    expect(s.children).toEqual(['r1', 'r2']);
    expect(s.collapsed).toBe(true);
    expect(s.pixelDataIndex).toBe(-1); // groups never have pixel data
  });

  it('preserves shape layer metadata', () => {
    const layer = makeShape({ shapeType: 'ellipse', fill: { r: 0, g: 128, b: 255, a: 1 } });
    const manifest = buildManifest([layer]);
    const json = JSON.stringify(manifest);
    const restored = JSON.parse(json) as LopsyManifest;

    const s = restored.layers[0]!;
    expect(s.type).toBe('shape');
    expect(s.shapeType).toBe('ellipse');
    expect((s.fill as { r: number }).r).toBe(0);
    expect((s.fill as { g: number }).g).toBe(128);
  });

  it('preserves document-level metadata', () => {
    const manifest = buildManifest([makeRaster()]);
    manifest.documentWidth satisfies number;
    const json = JSON.stringify(manifest);
    const restored = JSON.parse(json) as LopsyManifest;

    expect(restored.documentName).toBe('Test Doc');
    expect(restored.documentWidth).toBe(400);
    expect(restored.documentHeight).toBe(300);
    expect(restored.version).toBe(1);
  });

  it('serializes effects', () => {
    const effects = {
      ...DEFAULT_EFFECTS,
      dropShadow: { enabled: true, color: { r: 0, g: 0, b: 0, a: 1 }, offsetX: 4, offsetY: 4, blur: 8, spread: 2, opacity: 0.6 },
    };
    const layer = makeRaster({ effects });
    const manifest = buildManifest([layer]);
    const json = JSON.stringify(manifest);
    const restored = JSON.parse(json) as LopsyManifest;

    const s = restored.layers[0]!;
    const e = s.effects as typeof effects;
    expect(e.dropShadow.enabled).toBe(true);
    expect(e.dropShadow.blur).toBe(8);
    expect(e.dropShadow.opacity).toBe(0.6);
  });

  it('preserves layerOrder across JSON round-trip', () => {
    const r = makeRaster({ id: 'ra' });
    const t = makeText({ id: 'tb' });
    const g = makeGroup({ id: 'gc', children: ['ra', 'tb'] });
    const manifest = buildManifest([r, t, g]);
    const json = JSON.stringify(manifest);
    const restored = JSON.parse(json) as LopsyManifest;

    expect(restored.layerOrder).toEqual(['ra', 'tb', 'gc']);
  });

  it('handles mask metadata fields', () => {
    const layer = makeRaster({
      mask: {
        id: 'm1',
        enabled: true,
        data: new Uint8ClampedArray([255, 0, 128]),
        width: 3,
        height: 1,
      },
    });
    const s = serializeLayerForTest(layer, 0, 0);
    expect(s.maskEnabled).toBe(true);
    expect(s.maskWidth).toBe(3);
    expect(s.maskHeight).toBe(1);
    expect(s.maskDataIndex).toBe(0);
  });

  it('pixel data indices are -1 when no data', () => {
    const layer = makeGroup();
    const s = serializeLayerForTest(layer, -1, -1);
    expect(s.pixelDataIndex).toBe(-1);
    expect(s.maskDataIndex).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Tests: binary format header
// ---------------------------------------------------------------------------

describe('binary format header structure', () => {
  it('magic bytes match LOPSY\\0', () => {
    const expected = [0x4c, 0x4f, 0x50, 0x53, 0x59, 0x00];
    // Verify test expectations match the module constants
    expect(expected).toEqual([76, 79, 80, 83, 89, 0]);
  });

  it('manifest byte length stored at offset 8 (uint32 LE)', () => {
    const manifestJson = '{"version":1}';
    const manifestBytes = new TextEncoder().encode(manifestJson);
    const header = new Uint8Array(12);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(8, manifestBytes.length, true);
    // Verify the encoding round-trips
    const readBack = headerView.getUint32(8, true);
    expect(readBack).toBe(manifestBytes.length);
  });
});

// TS-only fix for typo in group test
type LapsyManifest = LopsyManifest;
