import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT_SETTINGS, exportKeepsLocation, exportSettingsFromJson } from '../export/types';
import type { EntityRecord } from './merge-store';
import { MemoryLocalStore } from './local-store';
import { allExportPresets, allPresets, BUILT_IN_EXPORT_PRESETS, BUILT_IN_PRESETS, findPreset } from './presets';
import { DEFAULT_RECIPE, recipeFromPaths, recipeHash } from './recipe';
import { openLibrary, type PhotosLibrarySession } from './session';
import { canonicalView } from './test-support/canonical';
import { pickOne, seededRandom, shuffled } from './test-support/random';
import { TestAdapter } from './test-support/test-adapter';
import type { Json, NewAsset } from './types';
import { exportPresetFromRecord, presetFromRecord } from './view';

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

function presetsOf(s: PhotosLibrarySession): unknown {
  const view = canonicalView(s.getView()) as Record<string, unknown>;
  return {
    presets: [...s.getView().presets].sort(([a], [b]) => (a < b ? -1 : 1)),
    exportPresets: [...s.getView().exportPresets].sort(([a], [b]) => (a < b ? -1 : 1)),
    settings: view.settings,
  };
}

describe('presets', () => {
  it('save, rename and delete, synced to other devices', async () => {
    const adapter = new TestAdapter();
    const a = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    const b = await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false });
    const recipe = recipeFromPaths({ 'tone.exposure': 1, 'framing.angle': 3, 'color.vibrance': 20 });
    const id = a.savePreset('Bright', recipe, ['tone', 'color', 'nope' as never]);
    const saved = a.getView().presets.get(id)!;
    expect(saved).toMatchObject({ name: 'Bright', groups: ['tone', 'color'], deleted: false });
    expect(saved.values['tone.exposure']).toBe(1);
    expect(saved.values['color.vibrance']).toBe(20);
    expect(saved.values['framing.angle']).toBeUndefined();
    a.renamePreset(id, 'Brighter');
    await a.syncNow();
    await b.syncNow();
    expect(b.getView().presets.get(id)?.name).toBe('Brighter');
    b.deletePreset(id);
    await b.syncNow();
    await a.syncNow();
    expect(a.getView().presets.get(id)?.deleted).toBe(true);
    expect(findPreset(a.getView().presets, id)).toBeNull();
  });

  it('converge under concurrent renames and deletes (seeded)', async () => {
    for (let seed = 1; seed <= 6; seed++) {
      const random = seededRandom(seed);
      const adapter = new TestAdapter();
      let wall = 1_000_000;
      const devices: PhotosLibrarySession[] = [];
      for (let i = 0; i < 3; i++) {
        devices.push(await openLibrary({ adapter, store: new MemoryLocalStore(), autoSync: false, now: () => wall + i * 1000 }));
      }
      const ids = [devices[0]!.savePreset('One', DEFAULT_RECIPE, ['tone']), devices[0]!.savePreset('Two', DEFAULT_RECIPE, ['color'])];
      const exportIds = [devices[0]!.saveExportPreset('Web', DEFAULT_EXPORT_SETTINGS)];
      for (const d of devices) await d.syncNow();
      for (const d of devices) await d.syncNow();
      for (let step = 0; step < 60; step++) {
        wall += Math.floor(random() * 500);
        const d = pickOne(random, devices);
        const roll = random();
        if (roll < 0.35) d.renamePreset(pickOne(random, ids), `name-${step}`);
        else if (roll < 0.5) d.deletePreset(pickOne(random, ids));
        else if (roll < 0.6) d.renameExportPreset(pickOne(random, exportIds), `export-${step}`);
        else if (roll < 0.65) d.deleteExportPreset(pickOne(random, exportIds));
        else if (roll < 0.7) ids.push(d.savePreset(`new-${step}`, DEFAULT_RECIPE, ['tone']));
        else await d.syncNow();
      }
      for (let round = 0; round < 2; round++) for (const d of shuffled(random, devices)) await d.syncNow();
      const expected = presetsOf(devices[0]!);
      for (const d of devices) expect(presetsOf(d), `seed ${seed}`).toEqual(expected);
    }
  });

  it('ships starters that are valid, and the user renames and deletes them like their own', async () => {
    expect(BUILT_IN_PRESETS.length).toBeGreaterThanOrEqual(4);
    for (const p of BUILT_IN_PRESETS) {
      expect(p.id.startsWith('builtin:')).toBe(true);
      expect(p.groups.length).toBeGreaterThan(0);
      expect(recipeHash(recipeFromPaths(p.values))).not.toBe(recipeHash(DEFAULT_RECIPE));
    }
    expect(BUILT_IN_PRESETS.find((p) => p.id === 'builtin:monochrome')?.values['profile.id']).toBe('monochrome');
    expect(BUILT_IN_EXPORT_PRESETS.map((p) => p.name)).toEqual([
      'Full size JPEG',
      'Web, 2048 px, sRGB',
      '16-bit TIFF, Display P3',
    ]);
    const s = await openLibrary({ adapter: new TestAdapter(), store: new MemoryLocalStore(), autoSync: false });
    const names = () => allPresets(s.getView().presets).map((p) => p.name);
    expect(names()).toEqual(BUILT_IN_PRESETS.map((p) => p.name));

    // Renamed: its name is the user's, what it does is still the starter's.
    s.renamePreset('builtin:warm', 'Golden hour');
    const renamed = findPreset(s.getView().presets, 'builtin:warm');
    expect(renamed?.name).toBe('Golden hour');
    expect(renamed?.values).toEqual(BUILT_IN_PRESETS.find((p) => p.id === 'builtin:warm')?.values);
    expect(names()).toContain('Golden hour');
    expect(names()).not.toContain('Warm');

    // Deleted: gone from the list, and from being found.
    s.deletePreset('builtin:punchy');
    expect(findPreset(s.getView().presets, 'builtin:punchy')).toBeNull();
    expect(names()).not.toContain('Punchy');
    expect(names().length).toBe(BUILT_IN_PRESETS.length - 1);

    // The user's own sit in the same list.
    s.savePreset('Mine', DEFAULT_RECIPE, ['tone']);
    expect(names()).toContain('Mine');

    // Export presets, the same.
    s.deleteExportPreset('builtin:web-2048');
    s.renameExportPreset('builtin:full-jpeg', 'Everything');
    expect(allExportPresets(s.getView().exportPresets).map((p) => p.name)).toEqual(['Everything', '16-bit TIFF, Display P3']);

    // An ID that only looks like a starter's is nothing.
    const before = s.getSyncStatus().pendingOps;
    s.renamePreset('builtin:no-such', 'Evil');
    s.deletePreset('builtin:no-such');
    expect(s.getSyncStatus().pendingOps).toBe(before);
  });
});

describe('export presets', () => {
  it('save with validated settings', async () => {
    const s = await openLibrary({ adapter: new TestAdapter(), store: new MemoryLocalStore(), autoSync: false });
    const id = s.saveExportPreset('Print', { ...DEFAULT_EXPORT_SETTINGS, format: 'tiff', colorSpace: 'rec2020' });
    expect(s.getView().exportPresets.get(id)?.settings).toMatchObject({ format: 'tiff', colorSpace: 'rec2020' });
    expect(() => s.saveExportPreset('Bad', { ...DEFAULT_EXPORT_SETTINGS, format: 'jpeg', colorSpace: 'rec2020' })).toThrow(
      /16-bit/,
    );
    s.renameExportPreset(id, 'Print 2');
    s.deleteExportPreset(id);
    expect(s.getView().exportPresets.get(id)).toMatchObject({ name: 'Print 2', deleted: true });
  });
});

describe('applyRecipeValues', () => {
  it('applies to many versions with one step each, and undo on one leaves the others', async () => {
    const s = await openLibrary({ adapter: new TestAdapter(), store: new MemoryLocalStore(), autoSync: false });
    const one = s.addAsset({ ...PHOTO, fileId: 'f1' });
    const two = s.addAsset({ ...PHOTO, fileId: 'f2' });
    s.applyRecipeValues(
      [one.versionId, two.versionId],
      { 'tone.exposure': 9, 'color.vibrance': 30, 'not.a.path': 1, 'framing.crop': { x: 0, y: 0, width: 2, height: 1 } },
      'Paste edits',
    );
    const recipe = (v: string) => s.getView().versions.get(v)!.recipe;
    expect(recipe(one.versionId).tone.exposure).toBe(5);
    expect(recipe(two.versionId).color.vibrance).toBe(30);
    expect(recipe(two.versionId).framing.crop).toBeNull();
    expect(s.history(one.versionId).map((h) => h.label)).toEqual(['Paste edits']);
    expect(s.history(two.versionId).map((h) => h.label)).toEqual(['Paste edits']);
    expect(s.undo(one.versionId)).toBe(true);
    expect(recipe(one.versionId).tone.exposure).toBe(0);
    expect(recipe(two.versionId).tone.exposure).toBe(5);
    expect(s.history(two.versionId)[0]?.active).toBe(true);
  });
});

describe('stored records claiming a built-in ID', () => {
  const record = (fields: Record<string, Json>) =>
    ({ fields: new Map(Object.entries(fields).map(([k, value]) => [k, { value }])), sets: new Map() }) as unknown as EntityRecord;

  it('can rename or delete the starter, and nothing else: what it does cannot be replaced', () => {
    const punchy = BUILT_IN_PRESETS.find((p) => p.id === 'builtin:punchy')!;
    const claimed = presetFromRecord('builtin:punchy', record({ name: 'Evil', values: { 'tone.exposure': 5 }, groups: ['color'] }));
    expect(claimed).toEqual({ ...punchy, name: 'Evil' });
    expect(presetFromRecord('builtin:punchy', record({ deleted: true }))).toEqual({ ...punchy, deleted: true });
    const web = BUILT_IN_EXPORT_PRESETS.find((p) => p.id === 'builtin:web-2048')!;
    expect(exportPresetFromRecord('builtin:web-2048', record({ name: 'Leak', settings: {} }))).toEqual({ ...web, name: 'Leak' });
    expect(presetFromRecord('builtin:no-such', record({ name: 'Evil' }))).toBeNull();
    expect(presetFromRecord('p-1', record({ name: 'Mine' }))?.name).toBe('Mine');
    expect(findPreset(new Map(), 'builtin:punchy')?.name).toBe('Punchy');
    const evil = { ...BUILT_IN_PRESETS[0]!, id: 'builtin:x', name: 'Evil' };
    expect(findPreset(new Map([['builtin:x', evil]]), 'builtin:x')).toBeNull();
  });

  it('exportKeepsLocation says when GPS would leave with an export', () => {
    expect(exportKeepsLocation(DEFAULT_EXPORT_SETTINGS)).toBe(false);
    expect(exportKeepsLocation({ metadata: 'all', removeLocation: false })).toBe(true);
    expect(exportKeepsLocation({ metadata: 'copyright', removeLocation: false })).toBe(false);
    expect(exportKeepsLocation(exportSettingsFromJson({ metadata: 'all', removeLocation: false }))).toBe(true);
  });
});
