// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useToolSettingsStore } from './tool-settings-store';

describe('setShapeSetting mode — issue #236 (invalid modes render incorrectly)', () => {
  it('accepts ellipse', () => {
    useToolSettingsStore.getState().setShapeSetting('mode', 'ellipse');
    expect(useToolSettingsStore.getState().settings.shape.mode).toBe('ellipse');
  });

  it('accepts polygon', () => {
    useToolSettingsStore.getState().setShapeSetting('mode', 'polygon');
    expect(useToolSettingsStore.getState().settings.shape.mode).toBe('polygon');
  });

  it('collapses invalid values like "rectangle" to ellipse instead of silently storing them', () => {
    useToolSettingsStore.getState().setShapeSetting('mode', 'polygon');
    // The setter is typed as ShapeMode but JS callers (and TS @ts-ignore
    // bypasses) can pass anything. The slice must collapse invalid values
    // to the documented default ('ellipse') so the GPU dispatch doesn't
    // render a polygon with stale `sides` when a caller asked for
    // "rectangle" — same guard as the quick-select slice.
    (useToolSettingsStore.getState().setShapeSetting as (k: 'mode', m: string) => void)('mode', 'rectangle');
    expect(useToolSettingsStore.getState().settings.shape.mode).toBe('ellipse');
  });

  it('collapses other invalid values (line, arrow, star) to ellipse', () => {
    const setter = useToolSettingsStore.getState().setShapeSetting as (k: 'mode', m: string) => void;
    setter('mode', 'line');
    expect(useToolSettingsStore.getState().settings.shape.mode).toBe('ellipse');
    setter('mode', 'arrow');
    expect(useToolSettingsStore.getState().settings.shape.mode).toBe('ellipse');
    setter('mode', 'star');
    expect(useToolSettingsStore.getState().settings.shape.mode).toBe('ellipse');
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
    store.getState().setBrushSetting('opacity', 50);
    expect(store.getState().settings.brush.opacity).toBe(50);
    store.getState().setBrushSetting('opacity', 200);
    expect(store.getState().settings.brush.opacity).toBe(100);
    store.getState().setBrushSetting('opacity', -5);
    expect(store.getState().settings.brush.opacity).toBe(1);
  });

  it('warns when setBrushSetting(opacity) receives a fractional value (likely 0–1 normalised)', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setBrushSetting('opacity', 0.5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = String(warnSpy.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('setBrushSetting(opacity)');
    expect(message).toContain('percent');
    expect(message).toContain('50');
    // The value still gets clamped into the percent range (no silent
    // 1%-stroke), so callers don't get the original footgun.
    expect(store.getState().settings.brush.opacity).toBe(1);
  });

  it('does not warn for the integer sentinel 0', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setBrushSetting('opacity', 0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn for legitimate percent values, including 1', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setBrushSetting('opacity', 1);
    store.getState().setBrushSetting('opacity', 50);
    store.getState().setBrushSetting('opacity', 100);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns at most once per setter even with repeated bad calls', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setBrushSetting('opacity', 0.5);
    store.getState().setBrushSetting('opacity', 0.2);
    store.getState().setBrushSetting('opacity', 0.99);
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

describe('recent fonts', () => {
  beforeEach(() => {
    useToolSettingsStore.setState({ recentFonts: [] });
  });

  it('prepends and de-duplicates recent fonts', () => {
    const { addRecentFont } = useToolSettingsStore.getState();
    addRecentFont('Inter');
    addRecentFont('Roboto');
    addRecentFont('Inter'); // moves Inter to the front
    expect(useToolSettingsStore.getState().recentFonts).toEqual(['Inter', 'Roboto']);
  });

  it('caps the list at 8 entries', () => {
    const { addRecentFont } = useToolSettingsStore.getState();
    for (let i = 0; i < 12; i++) addRecentFont(`Font ${i}`);
    const recent = useToolSettingsStore.getState().recentFonts;
    expect(recent).toHaveLength(8);
    expect(recent[0]).toBe('Font 11'); // most recent first
  });

  it('ignores blank font names', () => {
    useToolSettingsStore.getState().addRecentFont('   ');
    expect(useToolSettingsStore.getState().recentFonts).toEqual([]);
  });
});

describe('text spacing settings clamp (panel controls)', () => {
  it('clamps lineHeight, letterSpacing, and paragraphSpacing', () => {
    const s = useToolSettingsStore.getState();
    s.setTextSetting('lineHeight', 99);
    s.setTextSetting('letterSpacing', -999);
    s.setTextSetting('paragraphSpacing', -5);
    const text = useToolSettingsStore.getState().settings.text;
    expect(text.lineHeight).toBe(4);
    expect(text.letterSpacing).toBe(-20);
    expect(text.paragraphSpacing).toBe(0);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
    useToolSettingsStore.getState().setWandSetting('contiguous', false);
    expect(useToolSettingsStore.getState().settings.wand.contiguous).toBe(false);
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
    useToolSettingsStore.getState().setFillSetting('contiguous', false);
    expect(useToolSettingsStore.getState().settings.fill.contiguous).toBe(false);
    // Sibling slice reference preserved — selectors subscribed to
    // settings.wand should not re-render when fill changes.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
    useToolSettingsStore.getState().setMarqueeSetting('feather', 50);
    expect(useToolSettingsStore.getState().settings.marquee.feather).toBe(50);
    // Sibling slice references preserved — selectors subscribed to
    // settings.wand / settings.fill should not re-render when marquee
    // changes. This is the invariant that justifies slicing.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.fill).toBe(beforeFill);
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
    useToolSettingsStore.getState().setSmudgeSetting('size', 42);
    expect(useToolSettingsStore.getState().settings.smudge.size).toBe(42);
    // Sibling slice references preserved — selectors subscribed to the
    // other slices should not re-render when smudge changes. This is
    // the invariant that justifies slicing instead of fattening the
    // flat bag further.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.fill).toBe(beforeFill);
    expect(useToolSettingsStore.getState().settings.marquee).toBe(beforeMarquee);
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    useToolSettingsStore.getState().setTextSetting('lineHeight', 1.4);
    useToolSettingsStore.getState().setTextSetting('letterSpacing', 0);
    useToolSettingsStore.getState().setTextSetting('paragraphSpacing', 0);
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
      lineHeight: 1.4,
      letterSpacing: 0,
      paragraphSpacing: 0,
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: brush (#453)', () => {
  it('exposes brush settings under settings.brush with the legacy flat-bag defaults', () => {
    // Reset to the legacy defaults — prior tests in this file may have
    // mutated the slice through setBrushSetting.
    useToolSettingsStore.getState().setBrushSetting('size', 10);
    useToolSettingsStore.getState().setBrushSetting('opacity', 100);
    useToolSettingsStore.getState().setBrushSetting('hardness', 80);
    useToolSettingsStore.getState().setBrushSetting('spacing', 0);
    useToolSettingsStore.getState().setBrushSetting('scatter', 0);
    useToolSettingsStore.getState().setBrushSetting('angle', 0);
    useToolSettingsStore.getState().setBrushSetting('fade', 0);
    useToolSettingsStore.getState().setBrushSetting('taper', 0);
    const { brush } = useToolSettingsStore.getState().settings;
    expect(brush).toEqual({
      size: 10,
      opacity: 100,
      hardness: 80,
      spacing: 0,
      scatter: 0,
      angle: 0,
      fade: 0,
      taper: 0,
    });
  });

  it('setBrushSetting updates one field without disturbing the others', () => {
    const before = useToolSettingsStore.getState().settings.brush;
    useToolSettingsStore.getState().setBrushSetting('size', 42);
    const after = useToolSettingsStore.getState().settings.brush;
    expect(after.size).toBe(42);
    expect(after.opacity).toBe(before.opacity);
    expect(after.hardness).toBe(before.hardness);
    expect(after.spacing).toBe(before.spacing);
    expect(after.scatter).toBe(before.scatter);
    expect(after.angle).toBe(before.angle);
    expect(after.fade).toBe(before.fade);
    expect(after.taper).toBe(before.taper);
  });

  it('setBrushSetting clamps size into [1, 5000]', () => {
    useToolSettingsStore.getState().setBrushSetting('size', 0);
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(1);
    useToolSettingsStore.getState().setBrushSetting('size', 99999);
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(5000);
  });

  it('setBrushSetting clamps hardness into [0, 100]', () => {
    useToolSettingsStore.getState().setBrushSetting('hardness', -10);
    expect(useToolSettingsStore.getState().settings.brush.hardness).toBe(0);
    useToolSettingsStore.getState().setBrushSetting('hardness', 250);
    expect(useToolSettingsStore.getState().settings.brush.hardness).toBe(100);
  });

  it('setBrushSetting clamps spacing into [0, 200]', () => {
    useToolSettingsStore.getState().setBrushSetting('spacing', -1);
    expect(useToolSettingsStore.getState().settings.brush.spacing).toBe(0);
    useToolSettingsStore.getState().setBrushSetting('spacing', 9999);
    expect(useToolSettingsStore.getState().settings.brush.spacing).toBe(200);
  });

  it('setBrushSetting clamps scatter into [0, 100]', () => {
    useToolSettingsStore.getState().setBrushSetting('scatter', -1);
    expect(useToolSettingsStore.getState().settings.brush.scatter).toBe(0);
    useToolSettingsStore.getState().setBrushSetting('scatter', 9999);
    expect(useToolSettingsStore.getState().settings.brush.scatter).toBe(100);
  });

  it('setBrushSetting wraps angle into [0, 360) modulo', () => {
    // Replicates the legacy `setBrushAngle` shape so the shader gets a
    // clean modulo-wrapped degree value when callers pass a delta that
    // went negative or past 360 (e.g. via a wheel turn).
    useToolSettingsStore.getState().setBrushSetting('angle', 720);
    expect(useToolSettingsStore.getState().settings.brush.angle).toBe(0);
    useToolSettingsStore.getState().setBrushSetting('angle', -90);
    expect(useToolSettingsStore.getState().settings.brush.angle).toBe(270);
  });

  it('setBrushSetting clamps fade into [0, 5000]', () => {
    useToolSettingsStore.getState().setBrushSetting('fade', -1);
    expect(useToolSettingsStore.getState().settings.brush.fade).toBe(0);
    useToolSettingsStore.getState().setBrushSetting('fade', 99999);
    expect(useToolSettingsStore.getState().settings.brush.fade).toBe(5000);
  });

  it('setBrushSetting clamps taper into [0, 5000]', () => {
    useToolSettingsStore.getState().setBrushSetting('taper', -1);
    expect(useToolSettingsStore.getState().settings.brush.taper).toBe(0);
    useToolSettingsStore.getState().setBrushSetting('taper', 99999);
    expect(useToolSettingsStore.getState().settings.brush.taper).toBe(5000);
  });

  it('setBrushSetting preserves sibling slices', () => {
    // The settings.brush object must be replaced (so React/Zustand
    // selectors that subscribe to it re-render) but the surrounding
    // ToolSettings slices should not churn. Same invariant the prior
    // slices lock down — if a future refactor accidentally rebuilds
    // sibling slices, this test catches it.
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
    useToolSettingsStore.getState().setBrushSetting('scatter', 25);
    expect(useToolSettingsStore.getState().settings.brush.scatter).toBe(25);
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
  });

  it('setActivePreset writes brush dab dynamics through the slice', () => {
    // The preset-apply path was the largest cluster of brush flat-field
    // writes pre-slice — eight dab fields written through a single `set()`.
    // After the slice it routes through `settings.brush` so the slice
    // object identity changes (selectors fire) but sibling slices stay
    // referentially identical.
    const beforeWand = useToolSettingsStore.getState().settings.wand;
    const beforePencil = useToolSettingsStore.getState().settings.pencil;
    // Save a preset capturing the current brush state, then mutate the
    // slice, then re-apply the preset — the slice should snap back to
    // the captured values.
    useToolSettingsStore.getState().setBrushSetting('size', 22);
    useToolSettingsStore.getState().setBrushSetting('hardness', 55);
    useToolSettingsStore.getState().setBrushSetting('spacing', 18);
    useToolSettingsStore.getState().saveCurrentAsPreset('slice-test-preset');
    const presets = useToolSettingsStore.getState().presets;
    const savedPreset = presets[presets.length - 1]!;
    useToolSettingsStore.getState().setBrushSetting('size', 999);
    useToolSettingsStore.getState().setBrushSetting('hardness', 5);
    useToolSettingsStore.getState().setActivePreset(savedPreset.id);
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(22);
    expect(useToolSettingsStore.getState().settings.brush.hardness).toBe(55);
    expect(useToolSettingsStore.getState().settings.brush.spacing).toBe(18);
    // Sibling slices untouched by the preset-apply path.
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.pencil).toBe(beforePencil);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: dodge (#453)', () => {
  it('exposes dodge settings under settings.dodge with the legacy defaults', () => {
    // Reset to the legacy defaults — prior tests in this file may have
    // mutated the slice through setDodgeSetting.
    useToolSettingsStore.getState().setDodgeSetting('mode', 'dodge');
    useToolSettingsStore.getState().setDodgeSetting('exposure', 50);
    const { dodge } = useToolSettingsStore.getState().settings;
    expect(dodge).toEqual({ mode: 'dodge', exposure: 50 });
  });

  it('setDodgeSetting updates one field without disturbing the other', () => {
    const before = useToolSettingsStore.getState().settings.dodge;
    useToolSettingsStore.getState().setDodgeSetting('exposure', 75);
    const after = useToolSettingsStore.getState().settings.dodge;
    expect(after.exposure).toBe(75);
    expect(after.mode).toBe(before.mode);
  });

  it('setDodgeSetting toggles mode between dodge and burn', () => {
    useToolSettingsStore.getState().setDodgeSetting('mode', 'burn');
    expect(useToolSettingsStore.getState().settings.dodge.mode).toBe('burn');
    useToolSettingsStore.getState().setDodgeSetting('mode', 'dodge');
    expect(useToolSettingsStore.getState().settings.dodge.mode).toBe('dodge');
  });

  it('setDodgeSetting clamps exposure into [1, 100]', () => {
    // The legacy setDodgeExposure clamped to [1, 100], not [0, 100] —
    // a 0 here would silently produce a no-op dodge stroke, the same
    // percent-vs-normalised footgun guarded by the warn-once dedupe.
    // Preserve that range under the slice.
    useToolSettingsStore.getState().setDodgeSetting('exposure', -10);
    expect(useToolSettingsStore.getState().settings.dodge.exposure).toBe(1);
    useToolSettingsStore.getState().setDodgeSetting('exposure', 0);
    expect(useToolSettingsStore.getState().settings.dodge.exposure).toBe(1);
    useToolSettingsStore.getState().setDodgeSetting('exposure', 200);
    expect(useToolSettingsStore.getState().settings.dodge.exposure).toBe(100);
  });

  it('setDodgeSetting preserves sibling slices and unrelated fields', () => {
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
    const beforeBrushTexture = useToolSettingsStore.getState().settings.brushTexture;
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
    useToolSettingsStore.getState().setDodgeSetting('exposure', 42);
    expect(useToolSettingsStore.getState().settings.dodge.exposure).toBe(42);
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
    expect(useToolSettingsStore.getState().settings.brushTexture).toBe(beforeBrushTexture);
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: shape (#453)', () => {
  // Reset to the legacy defaults at the top of each test — prior tests
  // in this file (including the #236 mode guard suite at the top) and
  // sibling cases inside this block may have mutated the slice.
  beforeEach(() => {
    const set = useToolSettingsStore.getState().setShapeSetting;
    set('mode', 'ellipse');
    set('output', 'pixels');
    set('fillColor', { r: 255, g: 255, b: 255, a: 1 });
    set('strokeColor', null);
    set('strokeWidth', 2);
    set('polygonSides', 6);
    set('cornerRadius', 0);
  });

  it('exposes shape settings under settings.shape with the legacy defaults', () => {
    const { shape } = useToolSettingsStore.getState().settings;
    expect(shape).toEqual({
      mode: 'ellipse',
      output: 'pixels',
      fillColor: { r: 255, g: 255, b: 255, a: 1 },
      strokeColor: null,
      strokeWidth: 2,
      polygonSides: 6,
      cornerRadius: 0,
    });
  });

  it('setShapeSetting updates one field without disturbing the others', () => {
    const before = useToolSettingsStore.getState().settings.shape;
    useToolSettingsStore.getState().setShapeSetting('strokeWidth', 7);
    const after = useToolSettingsStore.getState().settings.shape;
    expect(after.strokeWidth).toBe(7);
    expect(after.mode).toBe(before.mode);
    expect(after.output).toBe(before.output);
    expect(after.fillColor).toBe(before.fillColor);
    expect(after.strokeColor).toBe(before.strokeColor);
    expect(after.polygonSides).toBe(before.polygonSides);
    expect(after.cornerRadius).toBe(before.cornerRadius);
  });

  it('setShapeSetting clamps strokeWidth into [1, 50]', () => {
    useToolSettingsStore.getState().setShapeSetting('strokeWidth', 0);
    expect(useToolSettingsStore.getState().settings.shape.strokeWidth).toBe(1);
    useToolSettingsStore.getState().setShapeSetting('strokeWidth', 9999);
    expect(useToolSettingsStore.getState().settings.shape.strokeWidth).toBe(50);
  });

  it('setShapeSetting rounds and clamps polygonSides into [3, 64]', () => {
    // Sides must be an integer — fractional sides render as the floor
    // count with weird seams. Legacy setShapePolygonSides rounded.
    useToolSettingsStore.getState().setShapeSetting('polygonSides', 2);
    expect(useToolSettingsStore.getState().settings.shape.polygonSides).toBe(3);
    useToolSettingsStore.getState().setShapeSetting('polygonSides', 9999);
    expect(useToolSettingsStore.getState().settings.shape.polygonSides).toBe(64);
    useToolSettingsStore.getState().setShapeSetting('polygonSides', 6.4);
    expect(useToolSettingsStore.getState().settings.shape.polygonSides).toBe(6);
    useToolSettingsStore.getState().setShapeSetting('polygonSides', 6.6);
    expect(useToolSettingsStore.getState().settings.shape.polygonSides).toBe(7);
  });

  it('setShapeSetting clamps cornerRadius into [0, 200]', () => {
    useToolSettingsStore.getState().setShapeSetting('cornerRadius', -10);
    expect(useToolSettingsStore.getState().settings.shape.cornerRadius).toBe(0);
    useToolSettingsStore.getState().setShapeSetting('cornerRadius', 9999);
    expect(useToolSettingsStore.getState().settings.shape.cornerRadius).toBe(200);
  });

  it('setShapeSetting passes nullable colors through, including null', () => {
    useToolSettingsStore.getState().setShapeSetting('fillColor', null);
    expect(useToolSettingsStore.getState().settings.shape.fillColor).toBeNull();
    const red = { r: 200, g: 30, b: 40, a: 0.5 };
    useToolSettingsStore.getState().setShapeSetting('strokeColor', red);
    expect(useToolSettingsStore.getState().settings.shape.strokeColor).toEqual(red);
  });

  it('setShapeSetting collapses invalid output to "pixels" (mirrors mode guard)', () => {
    useToolSettingsStore.getState().setShapeSetting('output', 'path');
    expect(useToolSettingsStore.getState().settings.shape.output).toBe('path');
    (useToolSettingsStore.getState().setShapeSetting as (k: 'output', v: string) => void)('output', 'vector');
    expect(useToolSettingsStore.getState().settings.shape.output).toBe('pixels');
  });

  it('setShapeSetting preserves sibling slices and unrelated fields', () => {
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
    useToolSettingsStore.getState().setShapeSetting('strokeWidth', 42);
    expect(useToolSettingsStore.getState().settings.shape.strokeWidth).toBe(42);
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: gradient (#453)', () => {
  beforeEach(() => {
    // Reset to the legacy defaults — prior tests in this file (and the
    // module-state persisted across tests) may have mutated the slice.
    useToolSettingsStore.getState().setGradientSetting('type', 'linear');
    useToolSettingsStore.getState().setGradientSetting('reverse', false);
    useToolSettingsStore.getState().setGradientSetting('stops', [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
    ]);
  });

  it('exposes gradient settings under settings.gradient with the legacy defaults', () => {
    const { gradient } = useToolSettingsStore.getState().settings;
    expect(gradient.type).toBe('linear');
    expect(gradient.reverse).toBe(false);
    expect(gradient.stops.length).toBe(2);
    expect(gradient.stops[0]).toEqual({ position: 0, color: { r: 0, g: 0, b: 0, a: 1 } });
    expect(gradient.stops[1]).toEqual({ position: 1, color: { r: 255, g: 255, b: 255, a: 1 } });
  });

  it('setGradientSetting updates one field without disturbing the others', () => {
    const before = useToolSettingsStore.getState().settings.gradient;
    useToolSettingsStore.getState().setGradientSetting('reverse', true);
    const after = useToolSettingsStore.getState().settings.gradient;
    expect(after.reverse).toBe(true);
    expect(after.type).toBe(before.type);
    expect(after.stops).toBe(before.stops);
  });

  it('setGradientSetting collapses unknown type strings to linear', () => {
    // The legacy setGradientType accepted anything typed as the union;
    // the slice tightens that to the documented default so a typed-string
    // @ts-ignore bypass can't leave the GPU dispatch staring at a stale
    // enum. Same shape as the shape slice (#623).
    useToolSettingsStore.getState().setGradientSetting('type', 'radial');
    expect(useToolSettingsStore.getState().settings.gradient.type).toBe('radial');
    (useToolSettingsStore.getState().setGradientSetting as (k: string, v: unknown) => void)('type', 'conic');
    expect(useToolSettingsStore.getState().settings.gradient.type).toBe('linear');
  });

  it('setGradientSetting clamps stops list above the max (the GPU dispatch uniform cap)', () => {
    const tooMany = Array.from({ length: 25 }, (_, i) => ({
      position: i / 24,
      color: { r: i * 10, g: 0, b: 0, a: 1 },
    }));
    useToolSettingsStore.getState().setGradientSetting('stops', tooMany);
    expect(useToolSettingsStore.getState().settings.gradient.stops.length).toBe(16);
  });

  it('setGradientSetting pads stops list below the min so the gradient shaders always have ≥2 stops', () => {
    useToolSettingsStore.getState().setGradientSetting('stops', [
      { position: 0.5, color: { r: 128, g: 128, b: 128, a: 1 } },
    ]);
    expect(useToolSettingsStore.getState().settings.gradient.stops.length).toBe(2);
  });

  it('setGradientSetting clamps per-stop position into [0, 1] and sorts', () => {
    useToolSettingsStore.getState().setGradientSetting('stops', [
      { position: 1.5, color: { r: 255, g: 0, b: 0, a: 1 } },
      { position: -0.5, color: { r: 0, g: 0, b: 255, a: 1 } },
    ]);
    const sorted = useToolSettingsStore.getState().settings.gradient.stops;
    expect(sorted.map((s) => s.position)).toEqual([0, 1]);
  });

  it('addGradientStop inserts and re-sorts via settings.gradient.stops', () => {
    useToolSettingsStore.getState().addGradientStop(0.5, { r: 128, g: 128, b: 128, a: 1 });
    const stops = useToolSettingsStore.getState().settings.gradient.stops;
    expect(stops.length).toBe(3);
    expect(stops.map((s) => s.position)).toEqual([0, 0.5, 1]);
  });

  it('addGradientStop is rejected at the max', () => {
    const max = Array.from({ length: 16 }, (_, i) => ({
      position: i / 15,
      color: { r: i, g: 0, b: 0, a: 1 },
    }));
    useToolSettingsStore.getState().setGradientSetting('stops', max);
    useToolSettingsStore.getState().addGradientStop(0.5, { r: 0, g: 255, b: 0, a: 1 });
    expect(useToolSettingsStore.getState().settings.gradient.stops.length).toBe(16);
  });

  it('removeGradientStop refuses to drop the list below the min', () => {
    useToolSettingsStore.getState().removeGradientStop(0);
    expect(useToolSettingsStore.getState().settings.gradient.stops.length).toBe(2);
  });

  it('updateGradientStop patches a single stop and re-sorts the list', () => {
    useToolSettingsStore.getState().setGradientSetting('stops', [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 0.5, color: { r: 128, g: 128, b: 128, a: 1 } },
      { position: 1, color: { r: 255, g: 255, b: 255, a: 1 } },
    ]);
    useToolSettingsStore.getState().updateGradientStop(1, { position: 0.9 });
    const stops = useToolSettingsStore.getState().settings.gradient.stops;
    expect(stops.map((s) => s.position)).toEqual([0, 0.9, 1]);
  });

  it('setGradientSetting preserves sibling slices and unrelated fields', () => {
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
    useToolSettingsStore.getState().setGradientSetting('reverse', true);
    expect(useToolSettingsStore.getState().settings.gradient.reverse).toBe(true);
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: crop (#453)', () => {
  it('exposes crop settings under settings.crop with the legacy default', () => {
    // Reset to the legacy default — prior tests in this file may have
    // mutated the slice through setCropSetting.
    useToolSettingsStore.getState().setCropSetting('mode', 'normal');
    const { crop } = useToolSettingsStore.getState().settings;
    expect(crop).toEqual({ mode: 'normal' });
  });

  it('setCropSetting toggles mode between normal and perspective', () => {
    useToolSettingsStore.getState().setCropSetting('mode', 'perspective');
    expect(useToolSettingsStore.getState().settings.crop.mode).toBe('perspective');
    useToolSettingsStore.getState().setCropSetting('mode', 'normal');
    expect(useToolSettingsStore.getState().settings.crop.mode).toBe('normal');
  });

  it('setCropSetting rejects unknown mode values and falls back to "normal"', () => {
    useToolSettingsStore.getState().setCropSetting('mode', 'perspective');
    // The setter is typed as CropSettings['mode'] but JS callers (and
    // any `as` cast in TS) can pass anything. The store must reject
    // unknown values so the crop dispatcher doesn't read a state that
    // neither the rect nor the perspective handler will service —
    // mirrors the setShapeMode reject-and-reset behaviour from #236.
    const setter = useToolSettingsStore.getState().setCropSetting as (
      key: 'mode',
      value: string,
    ) => void;
    setter('mode', 'rect');
    expect(useToolSettingsStore.getState().settings.crop.mode).toBe('normal');
    setter('mode', 'free');
    expect(useToolSettingsStore.getState().settings.crop.mode).toBe('normal');
  });

  it('setCropSetting preserves sibling slices and unrelated fields', () => {
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
    useToolSettingsStore.getState().setCropSetting('mode', 'perspective');
    expect(useToolSettingsStore.getState().settings.crop.mode).toBe('perspective');
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: brushSpeed (#453)', () => {
  // First sub-slice carved out of the flat `brushSpeed*` brush fields.
  // Same shape as the per-tool slices above: read via
  // `settings.brushSpeed.<field>`, write via `setBrushSpeedSetting`.
  // The remaining brush sub-slices (jitter, texture, tip/presets/
  // sub-brushes) still live flat on the store and land in follow-up
  // PRs.
  it('exposes brushSpeed settings under settings.brushSpeed with the legacy defaults', () => {
    // Reset to the legacy defaults — prior tests in this file may have
    // mutated the slice through setBrushSpeedSetting or setActivePreset.
    useToolSettingsStore.getState().setBrushSpeedSetting('size', 0);
    useToolSettingsStore.getState().setBrushSpeedSetting('sizeInvert', false);
    useToolSettingsStore.getState().setBrushSpeedSetting('sensitivity', 'med');
    const { brushSpeed } = useToolSettingsStore.getState().settings;
    expect(brushSpeed).toEqual({ size: 0, sizeInvert: false, sensitivity: 'med' });
  });

  it('setBrushSpeedSetting updates one field without disturbing the others', () => {
    useToolSettingsStore.getState().setBrushSpeedSetting('size', 50);
    useToolSettingsStore.getState().setBrushSpeedSetting('sizeInvert', true);
    useToolSettingsStore.getState().setBrushSpeedSetting('sensitivity', 'high');
    const before = useToolSettingsStore.getState().settings.brushSpeed;
    useToolSettingsStore.getState().setBrushSpeedSetting('size', 120);
    const after = useToolSettingsStore.getState().settings.brushSpeed;
    expect(after.size).toBe(120);
    expect(after.sizeInvert).toBe(before.sizeInvert);
    expect(after.sensitivity).toBe(before.sensitivity);
  });

  it('setBrushSpeedSetting clamps size into [0, 300]', () => {
    // The UI surfaces 0–100 with sizeInvert=false and 0–300 with
    // sizeInvert=true. The store-level clamp is the looser bound so
    // flipping the invert toggle never truncates the slider value.
    useToolSettingsStore.getState().setBrushSpeedSetting('size', -10);
    expect(useToolSettingsStore.getState().settings.brushSpeed.size).toBe(0);
    useToolSettingsStore.getState().setBrushSpeedSetting('size', 9999);
    expect(useToolSettingsStore.getState().settings.brushSpeed.size).toBe(300);
  });

  it('setBrushSpeedSetting accepts the three documented sensitivity values', () => {
    useToolSettingsStore.getState().setBrushSpeedSetting('sensitivity', 'low');
    expect(useToolSettingsStore.getState().settings.brushSpeed.sensitivity).toBe('low');
    useToolSettingsStore.getState().setBrushSpeedSetting('sensitivity', 'med');
    expect(useToolSettingsStore.getState().settings.brushSpeed.sensitivity).toBe('med');
    useToolSettingsStore.getState().setBrushSpeedSetting('sensitivity', 'high');
    expect(useToolSettingsStore.getState().settings.brushSpeed.sensitivity).toBe('high');
  });

  it('setBrushSpeedSetting collapses unknown sensitivity strings to "med"', () => {
    // brush-stroke.ts maps sensitivity to a moving-average window
    // (low → 6, med → 3, high → 2). An unrecognised enum would leave
    // the ternary on the `med` branch silently, so the slice collapses
    // unknown strings to 'med' explicitly — same enum-guard policy as
    // shape/quickSelect/gradient.
    useToolSettingsStore.getState().setBrushSpeedSetting('sensitivity', 'high');
    const setter = useToolSettingsStore.getState().setBrushSpeedSetting as (
      key: 'sensitivity',
      value: string,
    ) => void;
    setter('sensitivity', 'medium');
    expect(useToolSettingsStore.getState().settings.brushSpeed.sensitivity).toBe('med');
    setter('sensitivity', 'turbo');
    expect(useToolSettingsStore.getState().settings.brushSpeed.sensitivity).toBe('med');
  });

  it('setBrushSpeedSetting preserves sibling slices and unrelated fields', () => {
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
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
    useToolSettingsStore.getState().setBrushSpeedSetting('size', 42);
    expect(useToolSettingsStore.getState().settings.brushSpeed.size).toBe(42);
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
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
  });
});

describe('per-tool slice: brushJitter (#453)', () => {
  it('exposes brush-jitter settings under settings.brushJitter with the legacy defaults', () => {
    // Reset to defaults — earlier tests in this file may have mutated
    // the slice through setBrushJitterSetting.
    useToolSettingsStore.getState().setBrushJitterSetting('size', 0);
    useToolSettingsStore.getState().setBrushJitterSetting('hardness', 0);
    useToolSettingsStore.getState().setBrushJitterSetting('angle', 0);
    useToolSettingsStore.getState().setBrushJitterSetting('opacity', 0);
    const { brushJitter } = useToolSettingsStore.getState().settings;
    expect(brushJitter).toEqual({ size: 0, hardness: 0, angle: 0, opacity: 0 });
  });

  it('setBrushJitterSetting updates one field without disturbing the others', () => {
    useToolSettingsStore.getState().setBrushJitterSetting('size', 0);
    useToolSettingsStore.getState().setBrushJitterSetting('hardness', 0);
    useToolSettingsStore.getState().setBrushJitterSetting('angle', 0);
    useToolSettingsStore.getState().setBrushJitterSetting('opacity', 0);
    useToolSettingsStore.getState().setBrushJitterSetting('size', 40);
    const after = useToolSettingsStore.getState().settings.brushJitter;
    expect(after).toEqual({ size: 40, hardness: 0, angle: 0, opacity: 0 });
  });

  it('setBrushJitterSetting clamps every field into [0, 100]', () => {
    for (const key of ['size', 'hardness', 'angle', 'opacity'] as const) {
      useToolSettingsStore.getState().setBrushJitterSetting(key, -10);
      expect(useToolSettingsStore.getState().settings.brushJitter[key]).toBe(0);
      useToolSettingsStore.getState().setBrushJitterSetting(key, 9999);
      expect(useToolSettingsStore.getState().settings.brushJitter[key]).toBe(100);
    }
  });

  it('setBrushJitterSetting preserves sibling slices and unrelated fields', () => {
    const beforeWand = useToolSettingsStore.getState().settings.wand;
    const beforeHealing = useToolSettingsStore.getState().settings.healing;
    const beforeBrushSize = useToolSettingsStore.getState().settings.brush.size;
    useToolSettingsStore.getState().setBrushJitterSetting('angle', 25);
    expect(useToolSettingsStore.getState().settings.brushJitter.angle).toBe(25);
    expect(useToolSettingsStore.getState().settings.wand).toBe(beforeWand);
    expect(useToolSettingsStore.getState().settings.healing).toBe(beforeHealing);
    expect(useToolSettingsStore.getState().settings.brush.size).toBe(beforeBrushSize);
  });

  it('saveCurrentAsPreset captures the current brushJitter values', () => {
    useToolSettingsStore.getState().setBrushJitterSetting('size', 17);
    useToolSettingsStore.getState().setBrushJitterSetting('hardness', 23);
    useToolSettingsStore.getState().setBrushJitterSetting('angle', 31);
    useToolSettingsStore.getState().setBrushJitterSetting('opacity', 43);
    useToolSettingsStore.getState().saveCurrentAsPreset('jitter-roundtrip');
    const saved = useToolSettingsStore
      .getState()
      .presets.find((p) => p.name === 'jitter-roundtrip');
    expect(saved).toBeDefined();
    expect(saved?.sizeJitter).toBe(17);
    expect(saved?.hardnessJitter).toBe(23);
    expect(saved?.angleJitter).toBe(31);
    expect(saved?.opacityJitter).toBe(43);
  });

  it('setActivePreset restores brushJitter from the preset', () => {
    // Save under known-jitter, then drift the slice, then setActivePreset
    // and assert the slice came back. Exercises both the save path
    // (legacy flat preset fields) and the restore path (writes into the
    // new settings.brushJitter slice).
    useToolSettingsStore.getState().setBrushJitterSetting('size', 11);
    useToolSettingsStore.getState().setBrushJitterSetting('hardness', 22);
    useToolSettingsStore.getState().setBrushJitterSetting('angle', 33);
    useToolSettingsStore.getState().setBrushJitterSetting('opacity', 44);
    useToolSettingsStore.getState().saveCurrentAsPreset('jitter-restore');
    const presetId = useToolSettingsStore
      .getState()
      .presets.find((p) => p.name === 'jitter-restore')!.id;
    useToolSettingsStore.getState().setBrushJitterSetting('size', 0);
    useToolSettingsStore.getState().setBrushJitterSetting('opacity', 0);
    useToolSettingsStore.getState().setActivePreset(presetId);
    const restored = useToolSettingsStore.getState().settings.brushJitter;
    expect(restored).toEqual({ size: 11, hardness: 22, angle: 33, opacity: 44 });
  });
});
