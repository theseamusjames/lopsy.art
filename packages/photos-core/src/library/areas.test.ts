import { describe, expect, it } from 'vitest';
import { newId } from './ids';
import { MemoryLocalStore } from './local-store';
import {
  addArea,
  DEFAULT_COPY_GROUPS,
  DEFAULT_RECIPE,
  liveAreas,
  MAX_AREAS,
  pickGroups,
  rangeForPath,
  recipeFromPaths,
  recipeHash,
  recipeToPaths,
  removeArea,
  sanitizeRecipeValues,
  type Recipe,
} from './recipe';
import { openLibrary, type PhotosLibrarySession } from './session';
import { TestAdapter } from './test-support/test-adapter';
import type { NewAsset } from './types';

const PHOTO: NewAsset = {
  kind: 'original',
  fileId: 'f',
  sha256: 'a'.repeat(64),
  fileName: 'A.JPG',
  byteSize: 1,
  format: 'jpeg',
  mimeType: 'image/jpeg',
  capturedAt: null,
  importedAt: '2026-11-18T00:00:00.000Z',
  importId: 'i',
  width: null,
  height: null,
  orientation: 1,
  camera: null,
  lens: null,
  exposure: null,
  gps: null,
  pairedWith: null,
  source: null,
  renderFileId: null,
};

function withArea(recipe: Recipe, kind: 'linear' | 'radial', at: number): { recipe: Recipe; id: string } {
  const made = addArea(recipe, kind, newId(at));
  if (!made) throw new Error('full');
  return { recipe: recipeFromPaths({ ...recipeToPaths(recipe), ...made.values }), id: made.id };
}

describe('areas in the recipe', () => {
  it('has none by default and leaves existing hashes alone', () => {
    expect(DEFAULT_RECIPE.areas).toEqual({});
    expect(recipeHash(recipeFromPaths({}))).toBe(recipeHash(DEFAULT_RECIPE));
    expect(Object.keys(recipeToPaths(DEFAULT_RECIPE)).some((p) => p.startsWith('areas.'))).toBe(false);
    const { recipe } = withArea(DEFAULT_RECIPE, 'radial', 1000);
    expect(recipeHash(recipe)).not.toBe(recipeHash(DEFAULT_RECIPE));
  });

  it('round-trips through paths, clamps values and drops bad geometry', () => {
    const { recipe, id } = withArea(DEFAULT_RECIPE, 'linear', 1000);
    expect(recipeFromPaths(recipeToPaths(recipe))).toEqual(recipe);
    const p = `areas.${id}.`;
    const paths = { ...recipeToPaths(recipe), [`${p}adjustments.exposure`]: 99, [`${p}amount`]: -5 };
    const area = recipeFromPaths(paths).areas[id];
    expect(area?.adjustments.exposure).toBe(4);
    expect(area?.amount).toBe(0);
    expect(rangeForPath(`${p}adjustments.exposure`)).toEqual({ min: -4, max: 4, step: 0.01 });
    // A linear area whose ends meet, radial geometry on a linear area, or a missing kind: dropped.
    expect(recipeFromPaths({ ...paths, [`${p}geometry`]: { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 } }).areas).toEqual({});
    expect(recipeFromPaths({ ...paths, [`${p}geometry`]: { cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1, angle: 0, feather: 0 } }).areas).toEqual({});
    expect(recipeFromPaths({ ...paths, [`${p}kind`]: null }).areas).toEqual({});
    expect(recipeFromPaths({ ...paths, 'areas.bad.id!.kind': 'linear' }).areas[id]).toBeDefined();
  });

  it('keeps the oldest MAX_AREAS, in creation order, and refuses to add more', () => {
    let recipe = DEFAULT_RECIPE;
    const ids: string[] = [];
    for (let i = 0; i < MAX_AREAS; i++) {
      const made = withArea(recipe, i % 2 === 0 ? 'linear' : 'radial', 1000 + i);
      recipe = made.recipe;
      ids.push(made.id);
    }
    expect(liveAreas(recipe).map((a) => a.id)).toEqual(ids);
    expect(addArea(recipe, 'radial', newId(5000))).toBeNull();
    // Two devices each adding one past the limit: the newer is dropped, the same everywhere.
    const late = addArea(DEFAULT_RECIPE, 'radial', newId(9000))!;
    const early = addArea(DEFAULT_RECIPE, 'radial', newId(500))!;
    const both = recipeFromPaths({ ...recipeToPaths(recipe), ...late.values, ...early.values });
    expect(liveAreas(both).map((a) => a.id)).toEqual([early.id, ...ids.slice(0, MAX_AREAS - 1)]);
    // Deleting one frees a place.
    const freed = recipeFromPaths({ ...recipeToPaths(recipe), ...removeArea(ids[0]!) });
    expect(liveAreas(freed)).toHaveLength(MAX_AREAS - 1);
    expect(addArea(freed, 'linear', newId(6000))).not.toBeNull();
  });

  it('is its own copy group, off by default, and sanitizes leaf by leaf', () => {
    const { recipe, id } = withArea(DEFAULT_RECIPE, 'radial', 1000);
    expect(DEFAULT_COPY_GROUPS).not.toContain('areas');
    expect(Object.keys(pickGroups(recipe, DEFAULT_COPY_GROUPS)).some((p) => p.startsWith('areas.'))).toBe(false);
    expect(Object.keys(pickGroups(recipe, ['areas']))).toContain(`areas.${id}.geometry`);
    const p = `areas.${id}.`;
    expect(
      sanitizeRecipeValues({ [`${p}adjustments.exposure`]: 10, [`${p}adjustments.nope`]: 1, [`${p}geometry`]: 'x', [`${p}deleted`]: true }),
    ).toEqual({ [`${p}adjustments.exposure`]: 4, [`${p}deleted`]: true });
  });
});

async function twoDevices(): Promise<{ a: PhotosLibrarySession; b: PhotosLibrarySession; versionId: string }> {
  const adapter = new TestAdapter();
  let wall = 1_000_000;
  const a = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, now: () => (wall += 10) });
  const b = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, now: () => (wall += 10) + 1 });
  const { versionId } = a.addAsset(PHOTO);
  await a.syncNow();
  await b.syncNow();
  return { a, b, versionId };
}

async function exchange(a: PhotosLibrarySession, b: PhotosLibrarySession): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await a.syncNow();
    await b.syncNow();
  }
}

describe('areas across devices', () => {
  it('merge a move on one device with an exposure change on another', async () => {
    const { a, b, versionId } = await twoDevices();
    const made = addArea(DEFAULT_RECIPE, 'radial', newId(2_000_000))!;
    a.editRecipe(versionId, made.values, 'Add area');
    await exchange(a, b);
    const p = `areas.${made.id}.`;
    a.editRecipe(versionId, { [`${p}geometry`]: { cx: 0.2, cy: 0.3, rx: 0.1, ry: 0.2, angle: 15, feather: 30 } }, 'Move area');
    b.editRecipe(versionId, { [`${p}adjustments.exposure`]: 1.5 }, 'Area exposure');
    await exchange(a, b);
    for (const s of [a, b]) {
      const area = s.getView().versions.get(versionId)!.recipe.areas[made.id];
      expect(area?.geometry).toEqual({ cx: 0.2, cy: 0.3, rx: 0.1, ry: 0.2, angle: 15, feather: 30 });
      expect(area?.adjustments.exposure).toBe(1.5);
    }
  });

  it('keep an area deleted while another device edits it', async () => {
    const { a, b, versionId } = await twoDevices();
    const made = addArea(DEFAULT_RECIPE, 'linear', newId(2_000_000))!;
    a.editRecipe(versionId, made.values, 'Add area');
    await exchange(a, b);
    a.editRecipe(versionId, removeArea(made.id), 'Delete area');
    b.editRecipe(versionId, { [`areas.${made.id}.adjustments.contrast`]: 40 }, 'Area contrast');
    await exchange(a, b);
    for (const s of [a, b]) expect(s.getView().versions.get(versionId)!.recipe.areas).toEqual({});
    expect(recipeHash(a.getView().versions.get(versionId)!.recipe)).toBe(recipeHash(b.getView().versions.get(versionId)!.recipe));
  });

  it('undo removes an added area; setRecipe without an area deletes it', async () => {
    const { a, versionId } = await twoDevices();
    const made = addArea(DEFAULT_RECIPE, 'radial', newId(2_000_000))!;
    a.editRecipe(versionId, made.values, 'Add area');
    expect(liveAreas(a.getView().versions.get(versionId)!.recipe)).toHaveLength(1);
    expect(a.undo(versionId)).toBe(true);
    expect(a.getView().versions.get(versionId)!.recipe.areas).toEqual({});
    expect(a.redo(versionId)).toBe(true);
    a.setRecipe(versionId, { ...a.getView().versions.get(versionId)!.recipe, areas: {} }, 'Reset areas');
    expect(a.getView().versions.get(versionId)!.recipe.areas).toEqual({});
  });
});

describe('areas in whole-recipe writes', () => {
  it('New version copies the areas, linear and radial', async () => {
    const { a, b, versionId } = await twoDevices();
    const linear = addArea(DEFAULT_RECIPE, 'linear', newId(2_000_000))!;
    const radial = addArea(DEFAULT_RECIPE, 'radial', newId(2_000_010))!;
    a.editRecipe(versionId, { ...linear.values, ...radial.values }, 'Add areas');
    const recipe = a.getView().versions.get(versionId)!.recipe;
    expect(liveAreas(recipe)).toHaveLength(2);
    const second = a.createVersion(a.getView().versions.get(versionId)!.assetId, 'Copy', recipe);
    await exchange(a, b);
    for (const s of [a, b]) expect(s.getView().versions.get(second)!.recipe.areas).toEqual(recipe.areas);
  });

  it('Rotate, Flip and Reset write the whole recipe, areas and all', async () => {
    const { a, b, versionId } = await twoDevices();
    a.editRecipe(versionId, addArea(DEFAULT_RECIPE, 'radial', newId(2_000_000))!.values, 'Add area');
    const recipe = a.getView().versions.get(versionId)!.recipe;
    a.setRecipe(versionId, { ...recipe, framing: { ...recipe.framing, flipH: !recipe.framing.flipH } }, 'Flip');
    await exchange(a, b);
    for (const s of [a, b]) {
      const flipped = s.getView().versions.get(versionId)!.recipe;
      expect(flipped.framing.flipH).toBe(!recipe.framing.flipH);
      expect(flipped.areas).toEqual(recipe.areas);
    }
  });
});

describe('versions in albums and the primary version', () => {
  it('holds one version or the whole photo, as separate memberships', async () => {
    const { a, b, versionId } = await twoDevices();
    const assetId = a.getView().versions.get(versionId)!.assetId;
    const second = a.createVersion(assetId, 'Black and white');
    const album = a.createAlbum('Best');
    a.setAlbumMember(album, assetId, true, second);
    a.setAlbumMember(album, assetId, true);
    await exchange(a, b);
    expect(b.getView().albums.get(album)).toMatchObject({
      assetIds: [assetId],
      members: [
        { assetId, versionId: null },
        { assetId, versionId: second },
      ],
    });
    b.setAlbumMember(album, assetId, false);
    await exchange(a, b);
    expect(a.getView().albums.get(album)).toMatchObject({ assetIds: [], members: [{ assetId, versionId: second }] });
  });

  it('setPrimaryVersion changes the shown version and refuses a version of another photo', async () => {
    const { a, b, versionId } = await twoDevices();
    const assetId = a.getView().versions.get(versionId)!.assetId;
    const second = a.createVersion(assetId, 'Crop');
    a.setPrimaryVersion(assetId, second);
    await exchange(a, b);
    expect(b.getView().assets.get(assetId)?.primaryVersionId).toBe(second);
    const other = a.addAsset({ ...PHOTO, fileId: 'g', sha256: 'b'.repeat(64) });
    expect(() => a.setPrimaryVersion(assetId, other.versionId)).toThrow();
    a.deleteVersion(versionId);
    expect(() => a.setPrimaryVersion(assetId, versionId)).toThrow();
  });
});
