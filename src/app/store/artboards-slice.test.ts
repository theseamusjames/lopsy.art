import { describe, it, expect, beforeEach } from 'vitest';
import { create } from 'zustand';
import { createArtboardsSlice } from './artboards-slice';
import type { ArtboardsSlice } from './artboards-slice';

// Minimal store factory that only mounts the artboards slice.
// We cast to EditorState to satisfy SliceCreator's generic constraint while
// keeping the test self-contained — the slice only reads/writes artboards.
function makeStore() {
  return create<ArtboardsSlice>((...a) =>
    createArtboardsSlice(...(a as Parameters<typeof createArtboardsSlice>)),
  );
}

describe('artboards-slice', () => {
  let useStore: ReturnType<typeof makeStore>;

  beforeEach(() => {
    useStore = makeStore();
  });

  it('starts with an empty artboards list', () => {
    expect(useStore.getState().artboards).toEqual([]);
  });

  it('addArtboard appends an artboard with a generated id', () => {
    useStore.getState().addArtboard({ name: 'Hero', x: 0, y: 0, width: 800, height: 600 });
    const { artboards } = useStore.getState();
    expect(artboards).toHaveLength(1);
    const ab = artboards[0];
    expect(ab).toBeDefined();
    expect(ab!.name).toBe('Hero');
    expect(ab!.x).toBe(0);
    expect(ab!.y).toBe(0);
    expect(ab!.width).toBe(800);
    expect(ab!.height).toBe(600);
    expect(typeof ab!.id).toBe('string');
    expect(ab!.id.length).toBeGreaterThan(0);
  });

  it('addArtboard assigns a unique id to each artboard', () => {
    const s = useStore.getState();
    s.addArtboard({ name: 'A', x: 0, y: 0, width: 100, height: 100 });
    s.addArtboard({ name: 'B', x: 0, y: 0, width: 200, height: 200 });
    const { artboards } = useStore.getState();
    expect(artboards).toHaveLength(2);
    expect(artboards[0]!.id).not.toBe(artboards[1]!.id);
  });

  it('removeArtboard removes the artboard with the given id', () => {
    const s = useStore.getState();
    s.addArtboard({ name: 'A', x: 0, y: 0, width: 100, height: 100 });
    s.addArtboard({ name: 'B', x: 0, y: 0, width: 200, height: 200 });
    const { artboards: before } = useStore.getState();
    const idToRemove = before[0]!.id;

    useStore.getState().removeArtboard(idToRemove);

    const { artboards: after } = useStore.getState();
    expect(after).toHaveLength(1);
    expect(after[0]!.name).toBe('B');
  });

  it('removeArtboard is a no-op for an unknown id', () => {
    useStore.getState().addArtboard({ name: 'A', x: 0, y: 0, width: 100, height: 100 });
    useStore.getState().removeArtboard('does-not-exist');
    expect(useStore.getState().artboards).toHaveLength(1);
  });

  it('updateArtboard updates geometry fields', () => {
    useStore.getState().addArtboard({ name: 'A', x: 0, y: 0, width: 100, height: 100 });
    const id = useStore.getState().artboards[0]!.id;

    useStore.getState().updateArtboard(id, { x: 50, y: 75, width: 400, height: 300 });

    const ab = useStore.getState().artboards[0]!;
    expect(ab.x).toBe(50);
    expect(ab.y).toBe(75);
    expect(ab.width).toBe(400);
    expect(ab.height).toBe(300);
    expect(ab.name).toBe('A'); // name unchanged
  });

  it('renameArtboard updates only the name', () => {
    useStore.getState().addArtboard({ name: 'Old', x: 10, y: 20, width: 100, height: 100 });
    const id = useStore.getState().artboards[0]!.id;

    useStore.getState().renameArtboard(id, 'New Name');

    const ab = useStore.getState().artboards[0]!;
    expect(ab.name).toBe('New Name');
    expect(ab.x).toBe(10);
    expect(ab.y).toBe(20);
  });

  it('preserves other artboards when updating one', () => {
    const s = useStore.getState();
    s.addArtboard({ name: 'A', x: 0, y: 0, width: 100, height: 100 });
    s.addArtboard({ name: 'B', x: 0, y: 0, width: 200, height: 200 });
    const idA = useStore.getState().artboards[0]!.id;

    useStore.getState().renameArtboard(idA, 'A Renamed');

    const { artboards } = useStore.getState();
    expect(artboards[1]!.name).toBe('B');
  });
});
