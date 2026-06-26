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

  it('also warns from setEraserSetting(opacity) and setSpraySetting(opacity) (same footgun)', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setEraserSetting('opacity', 0.5);
    store.getState().setSpraySetting('opacity', 0.3);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0] ?? ''));
    expect(messages.some((m: string) => m.includes('setEraserSetting(opacity)'))).toBe(true);
    expect(messages.some((m: string) => m.includes('setSpraySetting(opacity)'))).toBe(true);
  });

  it('also warns from setHealingSetting(opacity) and clamps the value to 1', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setHealingSetting('opacity', 0.5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0] ?? ''));
    expect(messages.some((m: string) => m.includes('setHealingSetting(opacity)'))).toBe(true);
    // The clamp range starts at 1, so a normalised 0.5 ends up as 1, not 0,
    // which would have been a silent no-op stroke.
    expect(store.getState().settings.healing.opacity).toBe(1);
  });

  it('does not warn when setHealingSetting touches size with a fractional value', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setHealingSetting('size', 0.5);
    expect(warnSpy).not.toHaveBeenCalled();
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

describe('per-tool slice: text (#453)', () => {
  it('exposes text settings under settings.text with the legacy defaults', () => {
    // Reset to the legacy defaults — prior tests in this file may have
    // mutated the slice through setTextSetting.
    useToolSettingsStore.getState().setTextSetting('content', 'Text');
    useToolSettingsStore.getState().setTextSetting('fontSize', 24);
    useToolSettingsStore.getState().setTextSetting('fontFamily', 'Inter, sans-serif');
    useToolSettingsStore.getState().setTextSetting('fontWeight', 400);
    useToolSettingsStore.getState().setTextSetting('fontStyle', 'normal');
    useToolSettingsStore.getState().setTextSetting('align', 'left');
    useToolSettingsStore.getState().setTextSetting('underline', false);
    useToolSettingsStore.getState().setTextSetting('strikethrough', false);
    const { text } = useToolSettingsStore.getState().settings;
    expect(text).toEqual({
      content: 'Text',
      fontSize: 24,
      fontFamily: 'Inter, sans-serif',
      fontWeight: 400,
      fontStyle: 'normal',
      align: 'left',
      underline: false,
      strikethrough: false,
    });
  });

  it('setTextSetting updates one field without disturbing the others', () => {
    const before = useToolSettingsStore.getState().settings.text;
    useToolSettingsStore.getState().setTextSetting('fontSize', 72);
    const after = useToolSettingsStore.getState().settings.text;
    expect(after.fontSize).toBe(72);
    expect(after.fontFamily).toBe(before.fontFamily);
    expect(after.fontWeight).toBe(before.fontWeight);
    expect(after.fontStyle).toBe(before.fontStyle);
    expect(after.align).toBe(before.align);
    expect(after.underline).toBe(before.underline);
    expect(after.strikethrough).toBe(before.strikethrough);
  });

  it('setTextSetting clamps fontSize into [1, 500]', () => {
    useToolSettingsStore.getState().setTextSetting('fontSize', 0);
    expect(useToolSettingsStore.getState().settings.text.fontSize).toBe(1);
    useToolSettingsStore.getState().setTextSetting('fontSize', 99999);
    expect(useToolSettingsStore.getState().settings.text.fontSize).toBe(500);
    useToolSettingsStore.getState().setTextSetting('fontSize', 36);
    expect(useToolSettingsStore.getState().settings.text.fontSize).toBe(36);
  });

  it('setTextSetting accepts both normal and italic font styles', () => {
    useToolSettingsStore.getState().setTextSetting('fontStyle', 'italic');
    expect(useToolSettingsStore.getState().settings.text.fontStyle).toBe('italic');
    useToolSettingsStore.getState().setTextSetting('fontStyle', 'normal');
    expect(useToolSettingsStore.getState().settings.text.fontStyle).toBe('normal');
  });

  it('setTextSetting accepts all four alignment values', () => {
    for (const align of ['left', 'center', 'right', 'justify'] as const) {
      useToolSettingsStore.getState().setTextSetting('align', align);
      expect(useToolSettingsStore.getState().settings.text.align).toBe(align);
    }
  });

  it('setTextSetting toggles decoration booleans independently', () => {
    useToolSettingsStore.getState().setTextSetting('underline', true);
    useToolSettingsStore.getState().setTextSetting('strikethrough', true);
    expect(useToolSettingsStore.getState().settings.text.underline).toBe(true);
    expect(useToolSettingsStore.getState().settings.text.strikethrough).toBe(true);
    useToolSettingsStore.getState().setTextSetting('underline', false);
    expect(useToolSettingsStore.getState().settings.text.underline).toBe(false);
    // strikethrough unchanged
    expect(useToolSettingsStore.getState().settings.text.strikethrough).toBe(true);
  });

  it('setTextSetting preserves sibling slices and unrelated fields', () => {
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
    useToolSettingsStore.getState().setTextSetting('fontSize', 48);
    expect(useToolSettingsStore.getState().settings.text.fontSize).toBe(48);
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

describe('per-tool slice: spray (#453)', () => {
  it('exposes spray settings under settings.spray with the legacy defaults', () => {
    // Reset to the legacy defaults — prior tests in this file may have
    // mutated the slice through setSpraySetting.
    useToolSettingsStore.getState().setSpraySetting('size', 40);
    useToolSettingsStore.getState().setSpraySetting('density', 20);
    useToolSettingsStore.getState().setSpraySetting('opacity', 60);
    useToolSettingsStore.getState().setSpraySetting('hardness', 30);
    const { spray } = useToolSettingsStore.getState().settings;
    expect(spray).toEqual({ size: 40, density: 20, opacity: 60, hardness: 30 });
  });

  it('setSpraySetting updates one field without disturbing the others', () => {
    const before = useToolSettingsStore.getState().settings.spray;
    useToolSettingsStore.getState().setSpraySetting('density', 75);
    const after = useToolSettingsStore.getState().settings.spray;
    expect(after.density).toBe(75);
    expect(after.size).toBe(before.size);
    expect(after.opacity).toBe(before.opacity);
    expect(after.hardness).toBe(before.hardness);
  });

  it('setSpraySetting clamps size into [1, 5000]', () => {
    useToolSettingsStore.getState().setSpraySetting('size', 0);
    expect(useToolSettingsStore.getState().settings.spray.size).toBe(1);
    useToolSettingsStore.getState().setSpraySetting('size', 99999);
    expect(useToolSettingsStore.getState().settings.spray.size).toBe(5000);
  });

  it('setSpraySetting clamps density into [1, 100]', () => {
    useToolSettingsStore.getState().setSpraySetting('density', 0);
    expect(useToolSettingsStore.getState().settings.spray.density).toBe(1);
    useToolSettingsStore.getState().setSpraySetting('density', 9999);
    expect(useToolSettingsStore.getState().settings.spray.density).toBe(100);
  });

  it('setSpraySetting clamps opacity into [1, 100]', () => {
    // The legacy setSprayOpacity clamped to [1, 100], not [0, 100] —
    // a 0 here would silently produce a no-op spray stroke, the same
    // percent-vs-normalised footgun guarded by the warn-once dedupe.
    // Preserve that range under the slice.
    useToolSettingsStore.getState().setSpraySetting('opacity', -10);
    expect(useToolSettingsStore.getState().settings.spray.opacity).toBe(1);
    useToolSettingsStore.getState().setSpraySetting('opacity', 200);
    expect(useToolSettingsStore.getState().settings.spray.opacity).toBe(100);
  });

  it('setSpraySetting clamps hardness into [0, 100]', () => {
    // Hardness is exposed in the UI as a "Softness" slider with min 0,
    // so the slice mirrors that range — distinct from opacity's
    // [1, 100], where 0 would be a no-op.
    useToolSettingsStore.getState().setSpraySetting('hardness', -10);
    expect(useToolSettingsStore.getState().settings.spray.hardness).toBe(0);
    useToolSettingsStore.getState().setSpraySetting('hardness', 200);
    expect(useToolSettingsStore.getState().settings.spray.hardness).toBe(100);
  });

  it('setSpraySetting preserves sibling slices and unrelated fields', () => {
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
    useToolSettingsStore.getState().setSpraySetting('size', 42);
    expect(useToolSettingsStore.getState().settings.spray.size).toBe(42);
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

describe('per-tool slice: healing (#453)', () => {
  it('exposes healing settings under settings.healing with the legacy defaults', () => {
    // Reset to the legacy defaults — prior tests in this file may have
    // mutated the slice through setHealingSetting.
    useToolSettingsStore.getState().setHealingSetting('size', 20);
    useToolSettingsStore.getState().setHealingSetting('opacity', 100);
    const { healing } = useToolSettingsStore.getState().settings;
    expect(healing).toEqual({ size: 20, opacity: 100 });
  });

  it('setHealingSetting updates one field without disturbing the other', () => {
    const before = useToolSettingsStore.getState().settings.healing;
    useToolSettingsStore.getState().setHealingSetting('size', 75);
    const after = useToolSettingsStore.getState().settings.healing;
    expect(after.size).toBe(75);
    expect(after.opacity).toBe(before.opacity);
  });

  it('setHealingSetting clamps size into [1, 5000]', () => {
    useToolSettingsStore.getState().setHealingSetting('size', 0);
    expect(useToolSettingsStore.getState().settings.healing.size).toBe(1);
    useToolSettingsStore.getState().setHealingSetting('size', 99999);
    expect(useToolSettingsStore.getState().settings.healing.size).toBe(5000);
  });

  it('setHealingSetting clamps opacity into [1, 100]', () => {
    // The legacy setHealingOpacity clamped to [1, 100], not [0, 100] —
    // a 0 here would silently produce a no-op healing stroke, the same
    // percent-vs-normalised footgun guarded by the warn-once dedupe.
    // Preserve that range under the slice.
    useToolSettingsStore.getState().setHealingSetting('opacity', -10);
    expect(useToolSettingsStore.getState().settings.healing.opacity).toBe(1);
    useToolSettingsStore.getState().setHealingSetting('opacity', 200);
    expect(useToolSettingsStore.getState().settings.healing.opacity).toBe(100);
  });

  it('setHealingSetting preserves sibling slices and unrelated fields', () => {
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
    const beforeText = useToolSettingsStore.getState().settings.text;
    const beforeSpray = useToolSettingsStore.getState().settings.spray;
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setHealingSetting('size', 42);
    expect(useToolSettingsStore.getState().settings.healing.size).toBe(42);
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
    expect(useToolSettingsStore.getState().settings.text).toBe(beforeText);
    expect(useToolSettingsStore.getState().settings.spray).toBe(beforeSpray);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: brushTexture (#453)', () => {
  it('exposes brushTexture settings under settings.brushTexture with the legacy defaults', () => {
    // Reset to the legacy defaults — prior tests in this file may have
    // mutated the slice through setBrushTextureSetting (or through the
    // setActivePreset round-trip path, which also resets the slice).
    useToolSettingsStore.getState().setBrushTextureSetting('data', null);
    useToolSettingsStore.getState().setBrushTextureSetting('blendMode', 'multiply');
    useToolSettingsStore.getState().setBrushTextureSetting('scale', 100);
    const { brushTexture } = useToolSettingsStore.getState().settings;
    expect(brushTexture).toEqual({ data: null, blendMode: 'multiply', scale: 100 });
  });

  it('setBrushTextureSetting updates one field without disturbing the others', () => {
    const before = useToolSettingsStore.getState().settings.brushTexture;
    useToolSettingsStore.getState().setBrushTextureSetting('scale', 150);
    const after = useToolSettingsStore.getState().settings.brushTexture;
    expect(after.scale).toBe(150);
    expect(after.data).toBe(before.data);
    expect(after.blendMode).toBe(before.blendMode);
  });

  it('setBrushTextureSetting clamps scale into [10, 300]', () => {
    // The legacy setBrushTextureScale floored at 10, not 0 — a 0 scale
    // collapses the texture sampler. Preserve that range under the slice.
    useToolSettingsStore.getState().setBrushTextureSetting('scale', 0);
    expect(useToolSettingsStore.getState().settings.brushTexture.scale).toBe(10);
    useToolSettingsStore.getState().setBrushTextureSetting('scale', 9999);
    expect(useToolSettingsStore.getState().settings.brushTexture.scale).toBe(300);
  });

  it('setBrushTextureSetting accepts all three blend modes', () => {
    for (const mode of ['multiply', 'subtract', 'overlay'] as const) {
      useToolSettingsStore.getState().setBrushTextureSetting('blendMode', mode);
      expect(useToolSettingsStore.getState().settings.brushTexture.blendMode).toBe(mode);
    }
  });

  it('setBrushTextureSetting can clear data back to null', () => {
    const tex = {
      id: 'texture-clear-test',
      name: 'Test',
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(4),
    };
    useToolSettingsStore.getState().setBrushTextureSetting('data', tex);
    expect(useToolSettingsStore.getState().settings.brushTexture.data).toBe(tex);
    useToolSettingsStore.getState().setBrushTextureSetting('data', null);
    expect(useToolSettingsStore.getState().settings.brushTexture.data).toBe(null);
  });

  it('removeBrushTexture clears settings.brushTexture.data when the active texture is removed', () => {
    // The remove-active-texture invariant predates the slice — without
    // it, a stale BrushTextureData would survive after its underlying
    // entry was deleted from the available-textures catalogue, and the
    // engine sync would still try to upload a now-orphaned reference.
    const tex = {
      id: 'texture-remove-test',
      name: 'Test',
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(4),
    };
    useToolSettingsStore.getState().addBrushTexture(tex);
    useToolSettingsStore.getState().setBrushTextureSetting('data', tex);
    expect(useToolSettingsStore.getState().settings.brushTexture.data).toBe(tex);
    useToolSettingsStore.getState().removeBrushTexture(tex.id);
    expect(useToolSettingsStore.getState().settings.brushTexture.data).toBe(null);
    expect(useToolSettingsStore.getState().brushTextures.find((t) => t.id === tex.id)).toBeUndefined();
  });

  it('removeBrushTexture leaves settings.brushTexture.data alone when a different texture is removed', () => {
    const active = {
      id: 'texture-active',
      name: 'Active',
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(4),
    };
    const other = {
      id: 'texture-other',
      name: 'Other',
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(4),
    };
    useToolSettingsStore.getState().addBrushTexture(active);
    useToolSettingsStore.getState().addBrushTexture(other);
    useToolSettingsStore.getState().setBrushTextureSetting('data', active);
    useToolSettingsStore.getState().removeBrushTexture(other.id);
    expect(useToolSettingsStore.getState().settings.brushTexture.data).toBe(active);
  });

  it('setActivePreset resets the brushTexture slice to defaults', () => {
    // The setActivePreset path was the audit's largest single-`set`
    // cluster of brush flat-field writes that crossed the slice
    // boundary. Locking this in a test means the round-trip preset
    // path stays correct after future slice migrations.
    const tex = {
      id: 'texture-preset-test',
      name: 'Test',
      width: 2,
      height: 2,
      data: new Uint8ClampedArray(4),
    };
    useToolSettingsStore.getState().setBrushTextureSetting('data', tex);
    useToolSettingsStore.getState().setBrushTextureSetting('blendMode', 'overlay');
    useToolSettingsStore.getState().setBrushTextureSetting('scale', 200);
    const firstPresetId = useToolSettingsStore.getState().presets[0]?.id;
    if (!firstPresetId) throw new Error('No built-in presets available');
    useToolSettingsStore.getState().setActivePreset(firstPresetId);
    expect(useToolSettingsStore.getState().settings.brushTexture).toEqual({
      data: null,
      blendMode: 'multiply',
      scale: 100,
    });
  });

  it('setBrushTextureSetting preserves sibling slices and unrelated fields', () => {
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
    const beforeText = useToolSettingsStore.getState().settings.text;
    const beforeSpray = useToolSettingsStore.getState().settings.spray;
    const beforeHealing = useToolSettingsStore.getState().settings.healing;
    const beforeBrushSize = useToolSettingsStore.getState().brushSize;
    useToolSettingsStore.getState().setBrushTextureSetting('scale', 175);
    expect(useToolSettingsStore.getState().settings.brushTexture.scale).toBe(175);
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
    expect(useToolSettingsStore.getState().settings.text).toBe(beforeText);
    expect(useToolSettingsStore.getState().settings.spray).toBe(beforeSpray);
    expect(useToolSettingsStore.getState().settings.healing).toBe(beforeHealing);
    expect(useToolSettingsStore.getState().brushSize).toBe(beforeBrushSize);
  });
});
