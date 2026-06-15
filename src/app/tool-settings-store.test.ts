// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useToolSettingsStore } from './tool-settings-store';

describe('setShapeMode — issue #236 (invalid modes render incorrectly)', () => {
  it('accepts ellipse', () => {
    useToolSettingsStore.getState().setShapeMode('ellipse');
    expect(useToolSettingsStore.getState().shapeMode).toBe('ellipse');
  });

  it('accepts polygon', () => {
    useToolSettingsStore.getState().setShapeMode('polygon');
    expect(useToolSettingsStore.getState().shapeMode).toBe('polygon');
  });

  it('ignores invalid values like "rectangle" instead of silently storing them', () => {
    useToolSettingsStore.getState().setShapeMode('ellipse');
    // The setter is typed as ShapeMode but JS callers (and TS @ts-ignore
    // bypasses) can pass anything. The store must reject invalid values
    // so the GPU dispatch doesn't render a polygon with stale `sides`
    // when a caller asked for "rectangle".
    (useToolSettingsStore.getState().setShapeMode as (m: string) => void)('rectangle');
    expect(useToolSettingsStore.getState().shapeMode).toBe('ellipse');
  });

  it('ignores other invalid values (line, arrow, star)', () => {
    useToolSettingsStore.getState().setShapeMode('polygon');
    const setter = useToolSettingsStore.getState().setShapeMode as (m: string) => void;
    setter('line');
    setter('arrow');
    setter('star');
    expect(useToolSettingsStore.getState().shapeMode).toBe('polygon');
  });
});

describe('opacity setters — issue #250 (percent vs normalised footgun)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // The warn-once dedupe lives in module state, so re-import a fresh copy
    // for each test to make the warning behaviour deterministic.
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('clamps brush opacity to the documented 1–100 percent range', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setBrushOpacity(50);
    expect(store.getState().brushOpacity).toBe(50);
    store.getState().setBrushOpacity(200);
    expect(store.getState().brushOpacity).toBe(100);
    store.getState().setBrushOpacity(-5);
    expect(store.getState().brushOpacity).toBe(1);
  });

  it('warns when setBrushOpacity receives a fractional value (likely 0–1 normalised)', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setBrushOpacity(0.5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('setBrushOpacity');
    expect(message).toContain('percent');
    expect(message).toContain('50');
    // The value still gets clamped into the percent range (no silent
    // 1%-stroke), so callers don't get the original footgun.
    expect(store.getState().brushOpacity).toBe(1);
  });

  it('does not warn for the integer sentinel 0', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setBrushOpacity(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn for legitimate percent values, including 1', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setBrushOpacity(1);
    store.getState().setBrushOpacity(50);
    store.getState().setBrushOpacity(100);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns at most once per setter even with repeated bad calls', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setBrushOpacity(0.5);
    store.getState().setBrushOpacity(0.2);
    store.getState().setBrushOpacity(0.99);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('also warns from setEraserSetting(opacity) and setSprayOpacity (same footgun)', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setEraserSetting('opacity', 0.5);
    store.getState().setSprayOpacity(0.3);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0] ?? ''));
    expect(messages.some((m: string) => m.includes('setEraserSetting(opacity)'))).toBe(true);
    expect(messages.some((m: string) => m.includes('setSprayOpacity'))).toBe(true);
  });
});

describe('per-tool slice: wand (#453)', () => {
  it('exposes wand settings under settings.wand with the legacy defaults', () => {
    const { wand } = useToolSettingsStore.getState().settings;
    expect(wand).toEqual({ tolerance: 32, contiguous: true, graduated: false });
  });

  it('setWandSetting updates one field without disturbing the others', () => {
    const before = useToolSettingsStore.getState().settings.wand;
    useToolSettingsStore.getState().setWandSetting('tolerance', 60);
    const after = useToolSettingsStore.getState().settings.wand;
    expect(after.tolerance).toBe(60);
    expect(after.contiguous).toBe(before.contiguous);
    expect(after.graduated).toBe(before.graduated);
  });

  it('setWandSetting clamps tolerance into [0, 255]', () => {
    useToolSettingsStore.getState().setWandSetting('tolerance', -10);
    expect(useToolSettingsStore.getState().settings.wand.tolerance).toBe(0);
    useToolSettingsStore.getState().setWandSetting('tolerance', 9999);
    expect(useToolSettingsStore.getState().settings.wand.tolerance).toBe(255);
  });

  it('setWandSetting preserves referential identity outside the wand slice', () => {
    // The settings.wand object must be replaced (so React/Zustand
    // selectors that subscribe to it re-render) but the surrounding
    // ToolSettings shape should not churn unrelated fields.
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setWandSetting('contiguous', false);
    expect(useToolSettingsStore.getState().settings.wand.contiguous).toBe(false);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: fill (#453)', () => {
  it('exposes fill settings under settings.fill with the legacy defaults', () => {
    const { fill } = useToolSettingsStore.getState().settings;
    expect(fill).toEqual({ tolerance: 32, contiguous: true });
  });

  it('setFillSetting updates one field without disturbing the other', () => {
    const before = useToolSettingsStore.getState().settings.fill;
    useToolSettingsStore.getState().setFillSetting('tolerance', 60);
    const after = useToolSettingsStore.getState().settings.fill;
    expect(after.tolerance).toBe(60);
    expect(after.contiguous).toBe(before.contiguous);
  });

  it('setFillSetting clamps tolerance into [0, 255]', () => {
    useToolSettingsStore.getState().setFillSetting('tolerance', -10);
    expect(useToolSettingsStore.getState().settings.fill.tolerance).toBe(0);
    useToolSettingsStore.getState().setFillSetting('tolerance', 9999);
    expect(useToolSettingsStore.getState().settings.fill.tolerance).toBe(255);
  });

  it('setFillSetting preserves sibling slices and unrelated fields', () => {
    const beforeWand = useToolSettingsStore.getState().settings.wand;
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setFillSetting('contiguous', false);
    expect(useToolSettingsStore.getState().settings.fill.contiguous).toBe(false);
    // Sibling slice reference preserved — selectors subscribed to
    // settings.wand should not re-render when fill changes.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: marquee (#453)', () => {
  it('exposes marquee settings under settings.marquee with the legacy default', () => {
    // Reset to the legacy default — prior tests in this file may
    // have mutated the slice through setMarqueeSetting.
    useToolSettingsStore.getState().setMarqueeSetting('feather', 0);
    const { marquee } = useToolSettingsStore.getState().settings;
    expect(marquee).toEqual({ feather: 0 });
  });

  it('setMarqueeSetting updates feather and clamps it into [0, 250]', () => {
    useToolSettingsStore.getState().setMarqueeSetting('feather', 25);
    expect(useToolSettingsStore.getState().settings.marquee.feather).toBe(25);
    useToolSettingsStore.getState().setMarqueeSetting('feather', -10);
    expect(useToolSettingsStore.getState().settings.marquee.feather).toBe(0);
    useToolSettingsStore.getState().setMarqueeSetting('feather', 9999);
    expect(useToolSettingsStore.getState().settings.marquee.feather).toBe(250);
  });

  it('setMarqueeSetting rounds feather to an integer', () => {
    // Legacy setMarqueeFeather rounded — preserve that so feather
    // values stay integer-valued for downstream Gaussian-blur passes.
    useToolSettingsStore.getState().setMarqueeSetting('feather', 10.4);
    expect(useToolSettingsStore.getState().settings.marquee.feather).toBe(10);
    useToolSettingsStore.getState().setMarqueeSetting('feather', 10.6);
    expect(useToolSettingsStore.getState().settings.marquee.feather).toBe(11);
  });

  it('setMarqueeSetting preserves sibling slices and unrelated fields', () => {
    const beforeWand = useToolSettingsStore.getState().settings.wand;
    const beforeFill = useToolSettingsStore.getState().settings.fill;
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setMarqueeSetting('feather', 50);
    expect(useToolSettingsStore.getState().settings.marquee.feather).toBe(50);
    // Sibling slice references preserved — selectors subscribed to
    // settings.wand / settings.fill should not re-render when marquee
    // changes. This is the invariant that justifies slicing.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.fill).toBe(beforeFill);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: smudge (#453)', () => {
  it('exposes smudge settings under settings.smudge with the legacy defaults', () => {
    // Reset to the legacy defaults — prior tests in this file may have
    // mutated the slice through setSmudgeSetting.
    useToolSettingsStore.getState().setSmudgeSetting('size', 30);
    useToolSettingsStore.getState().setSmudgeSetting('strength', 50);
    const { smudge } = useToolSettingsStore.getState().settings;
    expect(smudge).toEqual({ size: 30, strength: 50 });
  });

  it('setSmudgeSetting updates one field without disturbing the other', () => {
    const before = useToolSettingsStore.getState().settings.smudge;
    useToolSettingsStore.getState().setSmudgeSetting('size', 80);
    const after = useToolSettingsStore.getState().settings.smudge;
    expect(after.size).toBe(80);
    expect(after.strength).toBe(before.strength);
  });

  it('setSmudgeSetting clamps size into [1, 5000]', () => {
    useToolSettingsStore.getState().setSmudgeSetting('size', 0);
    expect(useToolSettingsStore.getState().settings.smudge.size).toBe(1);
    useToolSettingsStore.getState().setSmudgeSetting('size', 99999);
    expect(useToolSettingsStore.getState().settings.smudge.size).toBe(5000);
  });

  it('setSmudgeSetting clamps strength into [0, 100]', () => {
    useToolSettingsStore.getState().setSmudgeSetting('strength', -10);
    expect(useToolSettingsStore.getState().settings.smudge.strength).toBe(0);
    useToolSettingsStore.getState().setSmudgeSetting('strength', 200);
    expect(useToolSettingsStore.getState().settings.smudge.strength).toBe(100);
  });

  it('setSmudgeSetting preserves sibling slices and unrelated fields', () => {
    const beforeWand = useToolSettingsStore.getState().settings.wand;
    const beforeFill = useToolSettingsStore.getState().settings.fill;
    const beforeMarquee = useToolSettingsStore.getState().settings.marquee;
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setSmudgeSetting('size', 42);
    expect(useToolSettingsStore.getState().settings.smudge.size).toBe(42);
    // Sibling slice references preserved — selectors subscribed to the
    // other slices should not re-render when smudge changes. This is
    // the invariant that justifies slicing instead of fattening the
    // flat bag further.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.fill).toBe(beforeFill);
    expect(useToolSettingsStore.getState().settings.marquee).toBe(beforeMarquee);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: pencil (#453)', () => {
  it('exposes pencil settings under settings.pencil with the legacy default', () => {
    // Reset to the legacy default — prior tests in this file may have
    // mutated the slice through setPencilSetting.
    useToolSettingsStore.getState().setPencilSetting('size', 1);
    const { pencil } = useToolSettingsStore.getState().settings;
    expect(pencil).toEqual({ size: 1 });
  });

  it('setPencilSetting updates size and clamps it into [1, 5000]', () => {
    useToolSettingsStore.getState().setPencilSetting('size', 25);
    expect(useToolSettingsStore.getState().settings.pencil.size).toBe(25);
    useToolSettingsStore.getState().setPencilSetting('size', 0);
    expect(useToolSettingsStore.getState().settings.pencil.size).toBe(1);
    useToolSettingsStore.getState().setPencilSetting('size', 99999);
    expect(useToolSettingsStore.getState().settings.pencil.size).toBe(5000);
  });

  it('setPencilSetting preserves sibling slices and unrelated fields', () => {
    const beforeWand = useToolSettingsStore.getState().settings.wand;
    const beforeFill = useToolSettingsStore.getState().settings.fill;
    const beforeMarquee = useToolSettingsStore.getState().settings.marquee;
    const beforeSmudge = useToolSettingsStore.getState().settings.smudge;
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setPencilSetting('size', 7);
    expect(useToolSettingsStore.getState().settings.pencil.size).toBe(7);
    // Sibling slice references preserved — selectors subscribed to the
    // other slices should not re-render when pencil changes. This is
    // the invariant that justifies slicing instead of fattening the
    // flat bag further.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.fill).toBe(beforeFill);
    expect(useToolSettingsStore.getState().settings.marquee).toBe(beforeMarquee);
    expect(useToolSettingsStore.getState().settings.smudge).toBe(beforeSmudge);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: sponge (#453)', () => {
  it('exposes sponge settings under settings.sponge with the legacy defaults', () => {
    // Reset to the legacy defaults — prior tests in this file may have
    // mutated the slice through setSpongeSetting.
    useToolSettingsStore.getState().setSpongeSetting('mode', 'desaturate');
    useToolSettingsStore.getState().setSpongeSetting('strength', 50);
    useToolSettingsStore.getState().setSpongeSetting('size', 30);
    const { sponge } = useToolSettingsStore.getState().settings;
    expect(sponge).toEqual({ mode: 'desaturate', strength: 50, size: 30 });
  });

  it('setSpongeSetting updates one field without disturbing the others', () => {
    const before = useToolSettingsStore.getState().settings.sponge;
    useToolSettingsStore.getState().setSpongeSetting('strength', 80);
    const after = useToolSettingsStore.getState().settings.sponge;
    expect(after.strength).toBe(80);
    expect(after.mode).toBe(before.mode);
    expect(after.size).toBe(before.size);
  });

  it('setSpongeSetting toggles mode between saturate and desaturate', () => {
    useToolSettingsStore.getState().setSpongeSetting('mode', 'saturate');
    expect(useToolSettingsStore.getState().settings.sponge.mode).toBe('saturate');
    useToolSettingsStore.getState().setSpongeSetting('mode', 'desaturate');
    expect(useToolSettingsStore.getState().settings.sponge.mode).toBe('desaturate');
  });

  it('setSpongeSetting clamps strength into [1, 100]', () => {
    useToolSettingsStore.getState().setSpongeSetting('strength', 0);
    expect(useToolSettingsStore.getState().settings.sponge.strength).toBe(1);
    useToolSettingsStore.getState().setSpongeSetting('strength', 9999);
    expect(useToolSettingsStore.getState().settings.sponge.strength).toBe(100);
  });

  it('setSpongeSetting clamps size into [1, 5000]', () => {
    useToolSettingsStore.getState().setSpongeSetting('size', 0);
    expect(useToolSettingsStore.getState().settings.sponge.size).toBe(1);
    useToolSettingsStore.getState().setSpongeSetting('size', 99999);
    expect(useToolSettingsStore.getState().settings.sponge.size).toBe(5000);
  });

  it('setSpongeSetting preserves sibling slices and unrelated fields', () => {
    const beforeWand = useToolSettingsStore.getState().settings.wand;
    const beforeFill = useToolSettingsStore.getState().settings.fill;
    const beforeMarquee = useToolSettingsStore.getState().settings.marquee;
    const beforeSmudge = useToolSettingsStore.getState().settings.smudge;
    const beforePencil = useToolSettingsStore.getState().settings.pencil;
    const beforeEraser = useToolSettingsStore.getState().settings.eraser;
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setSpongeSetting('size', 42);
    expect(useToolSettingsStore.getState().settings.sponge.size).toBe(42);
    // Sibling slice references preserved — selectors subscribed to the
    // other slices should not re-render when sponge changes. This is
    // the invariant that justifies slicing instead of fattening the
    // flat bag further.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.fill).toBe(beforeFill);
    expect(useToolSettingsStore.getState().settings.marquee).toBe(beforeMarquee);
    expect(useToolSettingsStore.getState().settings.smudge).toBe(beforeSmudge);
    expect(useToolSettingsStore.getState().settings.pencil).toBe(beforePencil);
    expect(useToolSettingsStore.getState().settings.eraser).toBe(beforeEraser);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: path (#453)', () => {
  it('exposes path settings under settings.path with the legacy default', () => {
    // Reset to the legacy default — prior tests in this file may have
    // mutated the slice through setPathSetting.
    useToolSettingsStore.getState().setPathSetting('strokeWidth', 2);
    const { path } = useToolSettingsStore.getState().settings;
    expect(path).toEqual({ strokeWidth: 2 });
  });

  it('setPathSetting updates strokeWidth and clamps it into [1, 50]', () => {
    useToolSettingsStore.getState().setPathSetting('strokeWidth', 25);
    expect(useToolSettingsStore.getState().settings.path.strokeWidth).toBe(25);
    useToolSettingsStore.getState().setPathSetting('strokeWidth', 0);
    expect(useToolSettingsStore.getState().settings.path.strokeWidth).toBe(1);
    useToolSettingsStore.getState().setPathSetting('strokeWidth', 9999);
    expect(useToolSettingsStore.getState().settings.path.strokeWidth).toBe(50);
  });

  it('setPathSetting preserves sibling slices and unrelated fields', () => {
    const beforeWand = useToolSettingsStore.getState().settings.wand;
    const beforeFill = useToolSettingsStore.getState().settings.fill;
    const beforeMarquee = useToolSettingsStore.getState().settings.marquee;
    const beforeSmudge = useToolSettingsStore.getState().settings.smudge;
    const beforePencil = useToolSettingsStore.getState().settings.pencil;
    const beforeSponge = useToolSettingsStore.getState().settings.sponge;
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setPathSetting('strokeWidth', 7);
    expect(useToolSettingsStore.getState().settings.path.strokeWidth).toBe(7);
    // Sibling slice references preserved — selectors subscribed to the
    // other slices should not re-render when path changes. This is the
    // invariant that justifies slicing instead of fattening the flat
    // bag further.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.fill).toBe(beforeFill);
    expect(useToolSettingsStore.getState().settings.marquee).toBe(beforeMarquee);
    expect(useToolSettingsStore.getState().settings.smudge).toBe(beforeSmudge);
    expect(useToolSettingsStore.getState().settings.pencil).toBe(beforePencil);
    expect(useToolSettingsStore.getState().settings.sponge).toBe(beforeSponge);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: stamp (#453)', () => {
  it('exposes stamp settings under settings.stamp with the legacy default', () => {
    // Reset to the legacy default — prior tests in this file may have
    // mutated the slice through setStampSetting.
    useToolSettingsStore.getState().setStampSetting('size', 20);
    const { stamp } = useToolSettingsStore.getState().settings;
    expect(stamp).toEqual({ size: 20 });
  });

  it('setStampSetting updates size and clamps it into [1, 5000]', () => {
    useToolSettingsStore.getState().setStampSetting('size', 75);
    expect(useToolSettingsStore.getState().settings.stamp.size).toBe(75);
    useToolSettingsStore.getState().setStampSetting('size', 0);
    expect(useToolSettingsStore.getState().settings.stamp.size).toBe(1);
    useToolSettingsStore.getState().setStampSetting('size', 99999);
    expect(useToolSettingsStore.getState().settings.stamp.size).toBe(5000);
  });

  it('setStampSetting preserves sibling slices and unrelated fields', () => {
    const beforeWand = useToolSettingsStore.getState().settings.wand;
    const beforeFill = useToolSettingsStore.getState().settings.fill;
    const beforeMarquee = useToolSettingsStore.getState().settings.marquee;
    const beforeSmudge = useToolSettingsStore.getState().settings.smudge;
    const beforePencil = useToolSettingsStore.getState().settings.pencil;
    const beforeSponge = useToolSettingsStore.getState().settings.sponge;
    const beforePath = useToolSettingsStore.getState().settings.path;
    const beforeEraser = useToolSettingsStore.getState().settings.eraser;
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setStampSetting('size', 42);
    expect(useToolSettingsStore.getState().settings.stamp.size).toBe(42);
    // Sibling slice references preserved — selectors subscribed to the
    // other slices should not re-render when stamp changes. This is the
    // invariant that justifies slicing instead of fattening the flat
    // bag further.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.fill).toBe(beforeFill);
    expect(useToolSettingsStore.getState().settings.marquee).toBe(beforeMarquee);
    expect(useToolSettingsStore.getState().settings.smudge).toBe(beforeSmudge);
    expect(useToolSettingsStore.getState().settings.pencil).toBe(beforePencil);
    expect(useToolSettingsStore.getState().settings.sponge).toBe(beforeSponge);
    expect(useToolSettingsStore.getState().settings.path).toBe(beforePath);
    expect(useToolSettingsStore.getState().settings.eraser).toBe(beforeEraser);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: magneticLasso (#453)', () => {
  it('exposes magneticLasso settings under settings.magneticLasso with the legacy defaults', () => {
    // Reset to the legacy defaults — prior tests in this file may have
    // mutated the slice through setMagneticLassoSetting.
    useToolSettingsStore.getState().setMagneticLassoSetting('width', 10);
    useToolSettingsStore.getState().setMagneticLassoSetting('contrast', 40);
    useToolSettingsStore.getState().setMagneticLassoSetting('frequency', 40);
    const { magneticLasso } = useToolSettingsStore.getState().settings;
    expect(magneticLasso).toEqual({ width: 10, contrast: 40, frequency: 40 });
  });

  it('setMagneticLassoSetting updates one field without disturbing the others', () => {
    const before = useToolSettingsStore.getState().settings.magneticLasso;
    useToolSettingsStore.getState().setMagneticLassoSetting('width', 25);
    const after = useToolSettingsStore.getState().settings.magneticLasso;
    expect(after.width).toBe(25);
    expect(after.contrast).toBe(before.contrast);
    expect(after.frequency).toBe(before.frequency);
  });

  it('setMagneticLassoSetting clamps width into [1, 40] and rounds', () => {
    useToolSettingsStore.getState().setMagneticLassoSetting('width', 0);
    expect(useToolSettingsStore.getState().settings.magneticLasso.width).toBe(1);
    useToolSettingsStore.getState().setMagneticLassoSetting('width', 999);
    expect(useToolSettingsStore.getState().settings.magneticLasso.width).toBe(40);
    useToolSettingsStore.getState().setMagneticLassoSetting('width', 10.4);
    expect(useToolSettingsStore.getState().settings.magneticLasso.width).toBe(10);
    useToolSettingsStore.getState().setMagneticLassoSetting('width', 10.6);
    expect(useToolSettingsStore.getState().settings.magneticLasso.width).toBe(11);
  });

  it('setMagneticLassoSetting clamps contrast into [1, 100] and rounds', () => {
    useToolSettingsStore.getState().setMagneticLassoSetting('contrast', 0);
    expect(useToolSettingsStore.getState().settings.magneticLasso.contrast).toBe(1);
    useToolSettingsStore.getState().setMagneticLassoSetting('contrast', 999);
    expect(useToolSettingsStore.getState().settings.magneticLasso.contrast).toBe(100);
    useToolSettingsStore.getState().setMagneticLassoSetting('contrast', 42.7);
    expect(useToolSettingsStore.getState().settings.magneticLasso.contrast).toBe(43);
  });

  it('setMagneticLassoSetting clamps frequency into [0, 200] and rounds', () => {
    // The frequency range starts at 0 (not 1) — a 0 frequency means
    // "never auto-anchor", which is a meaningful value for the magnetic
    // lasso, not a no-op like brush size 0.
    useToolSettingsStore.getState().setMagneticLassoSetting('frequency', -10);
    expect(useToolSettingsStore.getState().settings.magneticLasso.frequency).toBe(0);
    useToolSettingsStore.getState().setMagneticLassoSetting('frequency', 999);
    expect(useToolSettingsStore.getState().settings.magneticLasso.frequency).toBe(200);
    useToolSettingsStore.getState().setMagneticLassoSetting('frequency', 50.6);
    expect(useToolSettingsStore.getState().settings.magneticLasso.frequency).toBe(51);
  });

  it('setMagneticLassoSetting preserves sibling slices and unrelated fields', () => {
    const beforeWand = useToolSettingsStore.getState().settings.wand;
    const beforeFill = useToolSettingsStore.getState().settings.fill;
    const beforeMarquee = useToolSettingsStore.getState().settings.marquee;
    const beforeSmudge = useToolSettingsStore.getState().settings.smudge;
    const beforePencil = useToolSettingsStore.getState().settings.pencil;
    const beforeSponge = useToolSettingsStore.getState().settings.sponge;
    const beforePath = useToolSettingsStore.getState().settings.path;
    const beforeStamp = useToolSettingsStore.getState().settings.stamp;
    const beforeEraser = useToolSettingsStore.getState().settings.eraser;
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setMagneticLassoSetting('width', 25);
    expect(useToolSettingsStore.getState().settings.magneticLasso.width).toBe(25);
    // Sibling slice references preserved — selectors subscribed to the
    // other slices should not re-render when magneticLasso changes. This
    // is the invariant that justifies slicing instead of fattening the
    // flat bag further.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.fill).toBe(beforeFill);
    expect(useToolSettingsStore.getState().settings.marquee).toBe(beforeMarquee);
    expect(useToolSettingsStore.getState().settings.smudge).toBe(beforeSmudge);
    expect(useToolSettingsStore.getState().settings.pencil).toBe(beforePencil);
    expect(useToolSettingsStore.getState().settings.sponge).toBe(beforeSponge);
    expect(useToolSettingsStore.getState().settings.path).toBe(beforePath);
    expect(useToolSettingsStore.getState().settings.stamp).toBe(beforeStamp);
    expect(useToolSettingsStore.getState().settings.eraser).toBe(beforeEraser);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: eraser (#453)', () => {
  it('exposes eraser settings under settings.eraser with the legacy defaults', () => {
    // Reset to the legacy defaults — prior tests in this file may have
    // mutated the slice through setEraserSetting.
    useToolSettingsStore.getState().setEraserSetting('size', 10);
    useToolSettingsStore.getState().setEraserSetting('opacity', 100);
    const { eraser } = useToolSettingsStore.getState().settings;
    expect(eraser).toEqual({ size: 10, opacity: 100 });
  });

  it('setEraserSetting updates one field without disturbing the other', () => {
    const before = useToolSettingsStore.getState().settings.eraser;
    useToolSettingsStore.getState().setEraserSetting('size', 75);
    const after = useToolSettingsStore.getState().settings.eraser;
    expect(after.size).toBe(75);
    expect(after.opacity).toBe(before.opacity);
  });

  it('setEraserSetting clamps size into [1, 5000]', () => {
    useToolSettingsStore.getState().setEraserSetting('size', 0);
    expect(useToolSettingsStore.getState().settings.eraser.size).toBe(1);
    useToolSettingsStore.getState().setEraserSetting('size', 99999);
    expect(useToolSettingsStore.getState().settings.eraser.size).toBe(5000);
  });

  it('setEraserSetting clamps opacity into [1, 100]', () => {
    // The legacy setEraserOpacity clamped to [1, 100], not [0, 100] —
    // a 0 here would silently produce a no-op eraser stroke, which is
    // the same percent-vs-normalised footgun guarded by the warn-once
    // dedupe. Preserve that range under the slice.
    useToolSettingsStore.getState().setEraserSetting('opacity', -10);
    expect(useToolSettingsStore.getState().settings.eraser.opacity).toBe(1);
    useToolSettingsStore.getState().setEraserSetting('opacity', 200);
    expect(useToolSettingsStore.getState().settings.eraser.opacity).toBe(100);
  });

  it('setEraserSetting preserves sibling slices and unrelated fields', () => {
    const beforeWand = useToolSettingsStore.getState().settings.wand;
    const beforeFill = useToolSettingsStore.getState().settings.fill;
    const beforeMarquee = useToolSettingsStore.getState().settings.marquee;
    const beforeSmudge = useToolSettingsStore.getState().settings.smudge;
    const beforePencil = useToolSettingsStore.getState().settings.pencil;
    const beforeSponge = useToolSettingsStore.getState().settings.sponge;
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setEraserSetting('size', 42);
    expect(useToolSettingsStore.getState().settings.eraser.size).toBe(42);
    // Sibling slice references preserved — selectors subscribed to the
    // other slices should not re-render when eraser changes. This is
    // the invariant that justifies slicing instead of fattening the
    // flat bag further.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.fill).toBe(beforeFill);
    expect(useToolSettingsStore.getState().settings.marquee).toBe(beforeMarquee);
    expect(useToolSettingsStore.getState().settings.smudge).toBe(beforeSmudge);
    expect(useToolSettingsStore.getState().settings.pencil).toBe(beforePencil);
    expect(useToolSettingsStore.getState().settings.sponge).toBe(beforeSponge);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: quickSelect (#453)', () => {
  it('exposes quickSelect settings under settings.quickSelect with the legacy defaults', () => {
    // Reset to the legacy defaults — prior tests in this file may have
    // mutated the slice through setQuickSelectSetting.
    useToolSettingsStore.getState().setQuickSelectSetting('size', 20);
    useToolSettingsStore.getState().setQuickSelectSetting('tolerance', 32);
    useToolSettingsStore.getState().setQuickSelectSetting('edgeStrength', 50);
    useToolSettingsStore.getState().setQuickSelectSetting('mode', 'add');
    const { quickSelect } = useToolSettingsStore.getState().settings;
    expect(quickSelect).toEqual({ size: 20, tolerance: 32, edgeStrength: 50, mode: 'add' });
  });

  it('setQuickSelectSetting updates one field without disturbing the others', () => {
    const before = useToolSettingsStore.getState().settings.quickSelect;
    useToolSettingsStore.getState().setQuickSelectSetting('size', 40);
    const after = useToolSettingsStore.getState().settings.quickSelect;
    expect(after.size).toBe(40);
    expect(after.tolerance).toBe(before.tolerance);
    expect(after.edgeStrength).toBe(before.edgeStrength);
    expect(after.mode).toBe(before.mode);
  });

  it('setQuickSelectSetting clamps size into [1, 100] and rounds', () => {
    useToolSettingsStore.getState().setQuickSelectSetting('size', 0);
    expect(useToolSettingsStore.getState().settings.quickSelect.size).toBe(1);
    useToolSettingsStore.getState().setQuickSelectSetting('size', 999);
    expect(useToolSettingsStore.getState().settings.quickSelect.size).toBe(100);
    useToolSettingsStore.getState().setQuickSelectSetting('size', 12.4);
    expect(useToolSettingsStore.getState().settings.quickSelect.size).toBe(12);
    useToolSettingsStore.getState().setQuickSelectSetting('size', 12.6);
    expect(useToolSettingsStore.getState().settings.quickSelect.size).toBe(13);
  });

  it('setQuickSelectSetting clamps tolerance into [0, 255] and rounds', () => {
    // Tolerance lives in the same units as RGBA channels because the
    // stroke compares pixel deltas against it directly — preserve the
    // 0–255 byte range exactly, not a percent 0–100.
    useToolSettingsStore.getState().setQuickSelectSetting('tolerance', -10);
    expect(useToolSettingsStore.getState().settings.quickSelect.tolerance).toBe(0);
    useToolSettingsStore.getState().setQuickSelectSetting('tolerance', 999);
    expect(useToolSettingsStore.getState().settings.quickSelect.tolerance).toBe(255);
    useToolSettingsStore.getState().setQuickSelectSetting('tolerance', 60.6);
    expect(useToolSettingsStore.getState().settings.quickSelect.tolerance).toBe(61);
  });

  it('setQuickSelectSetting clamps edgeStrength into [0, 100] and rounds', () => {
    useToolSettingsStore.getState().setQuickSelectSetting('edgeStrength', -10);
    expect(useToolSettingsStore.getState().settings.quickSelect.edgeStrength).toBe(0);
    useToolSettingsStore.getState().setQuickSelectSetting('edgeStrength', 999);
    expect(useToolSettingsStore.getState().settings.quickSelect.edgeStrength).toBe(100);
    useToolSettingsStore.getState().setQuickSelectSetting('edgeStrength', 42.3);
    expect(useToolSettingsStore.getState().settings.quickSelect.edgeStrength).toBe(42);
  });

  it('setQuickSelectSetting normalises mode to a known tag', () => {
    useToolSettingsStore.getState().setQuickSelectSetting('mode', 'subtract');
    expect(useToolSettingsStore.getState().settings.quickSelect.mode).toBe('subtract');
    useToolSettingsStore.getState().setQuickSelectSetting('mode', 'add');
    expect(useToolSettingsStore.getState().settings.quickSelect.mode).toBe('add');
    // Unknown strings collapse to 'add' rather than silently passing
    // through — guards against a typed-string @ts-ignore bypass leaving
    // the selection in an unhandled state.
    (useToolSettingsStore.getState().setQuickSelectSetting as (k: 'mode', v: string) => void)('mode', 'replace');
    expect(useToolSettingsStore.getState().settings.quickSelect.mode).toBe('add');
  });

  it('setQuickSelectSetting preserves sibling slices and unrelated fields', () => {
    const beforeWand = useToolSettingsStore.getState().settings.wand;
    const beforeFill = useToolSettingsStore.getState().settings.fill;
    const beforeMarquee = useToolSettingsStore.getState().settings.marquee;
    const beforeSmudge = useToolSettingsStore.getState().settings.smudge;
    const beforePencil = useToolSettingsStore.getState().settings.pencil;
    const beforeSponge = useToolSettingsStore.getState().settings.sponge;
    const beforePath = useToolSettingsStore.getState().settings.path;
    const beforeStamp = useToolSettingsStore.getState().settings.stamp;
    const beforeEraser = useToolSettingsStore.getState().settings.eraser;
    const beforeMagneticLasso = useToolSettingsStore.getState().settings.magneticLasso;
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setQuickSelectSetting('size', 55);
    expect(useToolSettingsStore.getState().settings.quickSelect.size).toBe(55);
    // Sibling slice references preserved — selectors subscribed to the
    // other slices should not re-render when quickSelect changes. This
    // is the invariant that justifies slicing instead of fattening the
    // flat bag further.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.fill).toBe(beforeFill);
    expect(useToolSettingsStore.getState().settings.marquee).toBe(beforeMarquee);
    expect(useToolSettingsStore.getState().settings.smudge).toBe(beforeSmudge);
    expect(useToolSettingsStore.getState().settings.pencil).toBe(beforePencil);
    expect(useToolSettingsStore.getState().settings.sponge).toBe(beforeSponge);
    expect(useToolSettingsStore.getState().settings.path).toBe(beforePath);
    expect(useToolSettingsStore.getState().settings.stamp).toBe(beforeStamp);
    expect(useToolSettingsStore.getState().settings.eraser).toBe(beforeEraser);
    expect(useToolSettingsStore.getState().settings.magneticLasso).toBe(beforeMagneticLasso);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});
