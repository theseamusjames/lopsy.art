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

  it('also warns from setEraserOpacity and setSprayOpacity (same footgun)', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setEraserOpacity(0.5);
    store.getState().setSprayOpacity(0.3);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0] ?? ''));
    expect(messages.some((m: string) => m.includes('setEraserOpacity'))).toBe(true);
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
