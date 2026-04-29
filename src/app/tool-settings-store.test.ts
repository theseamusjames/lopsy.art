// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
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
