import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';
import { applyChanges } from '../edit-controls';
import { harnessAsset } from './harness-asset';
import { EMPTY_HARNESS, currentPhoto, currentVersion, harnessReducer, type HarnessState } from './harness-state';

const a = harnessAsset('a', 'a.jpg', 1, 'jpeg', 'image/jpeg');
const b = harnessAsset('b', 'b.jpg', 1, 'jpeg', 'image/jpeg');
const bright = applyChanges(DEFAULT_RECIPE, { 'tone.exposure': 1 });

function opened(): HarnessState {
  return harnessReducer(EMPTY_HARNESS, { kind: 'open', assets: [a, b], recipe: DEFAULT_RECIPE });
}

describe('harnessReducer', () => {
  it('opens files with an Original version each and shows the first', () => {
    const s = opened();
    expect(currentPhoto(s)?.asset.id).toBe('a');
    expect(currentVersion(s)?.name).toBe('Original');
    expect(harnessReducer(s, { kind: 'show', assetId: 'b' }).currentAssetId).toBe('b');
  });

  it('keeps a history per version', () => {
    let s = harnessReducer(opened(), { kind: 'step', recipe: bright, label: 'Exposure +1.00' });
    s = harnessReducer(s, { kind: 'createVersion', name: 'Black & white', recipe: bright });
    expect(currentVersion(s)?.name).toBe('Black & white');
    expect(currentVersion(s)?.history.present).toBe(bright);
    s = harnessReducer(s, { kind: 'undo' });
    expect(currentVersion(s)?.history.present).toBe(bright);
    const original = currentPhoto(s)?.versions[0];
    s = harnessReducer(s, { kind: 'selectVersion', versionId: original?.id ?? '' });
    s = harnessReducer(s, { kind: 'undo' });
    expect(currentVersion(s)?.history.present).toBe(DEFAULT_RECIPE);
  });

  it('renames and deletes versions but keeps the last one', () => {
    let s = harnessReducer(opened(), { kind: 'createVersion', name: 'Two', recipe: DEFAULT_RECIPE });
    const two = currentVersion(s)?.id ?? '';
    s = harnessReducer(s, { kind: 'renameVersion', versionId: two, name: 'Square' });
    expect(currentVersion(s)?.name).toBe('Square');
    s = harnessReducer(s, { kind: 'deleteVersion', versionId: two });
    expect(currentPhoto(s)?.versions.map((v) => v.name)).toEqual(['Original']);
    s = harnessReducer(s, { kind: 'deleteVersion', versionId: currentVersion(s)?.id ?? '' });
    expect(currentPhoto(s)?.versions).toHaveLength(1);
  });
});
