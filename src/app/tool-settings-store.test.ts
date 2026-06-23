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

  it('also warns from setEraserOpacity and setSpraySetting(opacity) (same footgun)', async () => {
    const { useToolSettingsStore: store } = await import('./tool-settings-store');
    store.getState().setEraserOpacity(0.5);
    store.getState().setSpraySetting('opacity', 0.3);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    const messages = warnSpy.mock.calls.map((c: unknown[]) => String(c[0] ?? ''));
    expect(messages.some((m: string) => m.includes('setEraserOpacity'))).toBe(true);
    expect(messages.some((m: string) => m.includes('setSpraySetting(opacity)'))).toBe(true);
  });
});

describe('per-tool slice: spray (#453)', () => {
  it('initialises settings.spray with the documented defaults', () => {
    const s = useToolSettingsStore.getState();
    expect(s.settings.spray).toEqual({
      size: 40,
      density: 20,
      opacity: 60,
      hardness: 30,
    });
  });

  it('setSpraySetting updates a single field via the typed setter', () => {
    useToolSettingsStore.getState().setSpraySetting('size', 120);
    expect(useToolSettingsStore.getState().settings.spray.size).toBe(120);
    expect(useToolSettingsStore.getState().settings.spray.density).toBe(20);

    useToolSettingsStore.getState().setSpraySetting('density', 80);
    expect(useToolSettingsStore.getState().settings.spray.density).toBe(80);
    expect(useToolSettingsStore.getState().settings.spray.size).toBe(120);
  });

  it('setSpraySetting clamps through clampSpraySetting (size into [1, 5000])', () => {
    useToolSettingsStore.getState().setSpraySetting('size', 99999);
    expect(useToolSettingsStore.getState().settings.spray.size).toBe(5000);
    useToolSettingsStore.getState().setSpraySetting('size', -10);
    expect(useToolSettingsStore.getState().settings.spray.size).toBe(1);
  });

  it('setSpraySetting clamps density / opacity / hardness to their documented ranges', () => {
    useToolSettingsStore.getState().setSpraySetting('density', 200);
    expect(useToolSettingsStore.getState().settings.spray.density).toBe(100);
    useToolSettingsStore.getState().setSpraySetting('opacity', -5);
    expect(useToolSettingsStore.getState().settings.spray.opacity).toBe(1);
    useToolSettingsStore.getState().setSpraySetting('hardness', -5);
    expect(useToolSettingsStore.getState().settings.spray.hardness).toBe(0);
    useToolSettingsStore.getState().setSpraySetting('hardness', 250);
    expect(useToolSettingsStore.getState().settings.spray.hardness).toBe(100);
  });

  it('setSpraySetting replaces the spray slice in one set() so the slice is referentially fresh after a write', () => {
    const before = useToolSettingsStore.getState().settings.spray;
    useToolSettingsStore.getState().setSpraySetting('size', 50);
    const after = useToolSettingsStore.getState().settings.spray;
    expect(after).not.toBe(before);
    expect(after.size).toBe(50);
  });
});
