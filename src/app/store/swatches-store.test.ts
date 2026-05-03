import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock localStorage before importing the store
const storage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { for (const k in storage) delete storage[k]; },
});

// Import after stubbing so the store initialises from our mock storage
const { useSwatchesStore } = await import('./swatches-store');

function getStore() {
  return useSwatchesStore.getState();
}

describe('swatches-store', () => {
  beforeEach(() => {
    // Reset store to defaults before each test
    useSwatchesStore.setState({ swatches: [] });
  });

  it('addSwatch appends a swatch with given color and optional name', () => {
    const color = { r: 255, g: 0, b: 0, a: 1 };
    getStore().addSwatch(color, 'Crimson');
    const { swatches } = getStore();
    expect(swatches).toHaveLength(1);
    const [first] = swatches;
    expect(first?.name).toBe('Crimson');
    expect(first?.color).toEqual(color);
    expect(first?.id).toBeTruthy();
  });

  it('addSwatch generates a default name when none is provided', () => {
    getStore().addSwatch({ r: 0, g: 128, b: 255, a: 1 });
    const [first] = getStore().swatches;
    expect(first?.name).toBeTruthy();
    expect((first?.name ?? '').length).toBeGreaterThan(0);
  });

  it('addSwatch generates unique ids for each swatch', () => {
    const color = { r: 10, g: 20, b: 30, a: 1 };
    getStore().addSwatch(color, 'A');
    getStore().addSwatch(color, 'B');
    const [a, b] = getStore().swatches;
    expect(a?.id).not.toBe(b?.id);
  });

  it('removeSwatch removes the correct swatch by id', () => {
    getStore().addSwatch({ r: 1, g: 2, b: 3, a: 1 }, 'First');
    getStore().addSwatch({ r: 4, g: 5, b: 6, a: 1 }, 'Second');
    const [first] = getStore().swatches;
    const idToRemove = first?.id ?? '';
    getStore().removeSwatch(idToRemove);
    const { swatches } = getStore();
    expect(swatches).toHaveLength(1);
    const [remaining] = swatches;
    expect(remaining?.name).toBe('Second');
  });

  it('removeSwatch is a no-op for unknown id', () => {
    getStore().addSwatch({ r: 1, g: 2, b: 3, a: 1 }, 'Only');
    getStore().removeSwatch('nonexistent-id');
    expect(getStore().swatches).toHaveLength(1);
  });

  it('renameSwatch updates the name of the correct swatch', () => {
    getStore().addSwatch({ r: 10, g: 20, b: 30, a: 1 }, 'Old Name');
    const [first] = getStore().swatches;
    const id = first?.id ?? '';
    getStore().renameSwatch(id, 'New Name');
    const [renamed] = getStore().swatches;
    expect(renamed?.name).toBe('New Name');
  });

  it('renameSwatch does not affect other swatches', () => {
    getStore().addSwatch({ r: 1, g: 2, b: 3, a: 1 }, 'Alpha');
    getStore().addSwatch({ r: 4, g: 5, b: 6, a: 1 }, 'Beta');
    const [firstSwatch] = getStore().swatches;
    const idAlpha = firstSwatch?.id ?? '';
    getStore().renameSwatch(idAlpha, 'Alpha Renamed');
    const [, secondSwatch] = getStore().swatches;
    expect(secondSwatch?.name).toBe('Beta');
  });

  it('clearSwatches empties the list', () => {
    getStore().addSwatch({ r: 1, g: 2, b: 3, a: 1 }, 'A');
    getStore().addSwatch({ r: 4, g: 5, b: 6, a: 1 }, 'B');
    getStore().clearSwatches();
    expect(getStore().swatches).toHaveLength(0);
  });
});
