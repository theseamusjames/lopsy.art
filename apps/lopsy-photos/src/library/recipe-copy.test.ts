import { describe, expect, it } from 'vitest';
import { DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';
import type { Json, LibrarySession } from '@lopsy/photos-core/library/types';
import { asGroupIds, DEFAULT_COPY_GROUP_IDS, pasteLabel, pasteRecipeValues, pickRecipeValues } from './recipe-copy';

const recipe = {
  ...DEFAULT_RECIPE,
  tone: { ...DEFAULT_RECIPE.tone, exposure: 0.7 },
  framing: { ...DEFAULT_RECIPE.framing, rotate: 90 as const, crop: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } },
};

describe('copying edits', () => {
  it('leaves framing out by default', () => {
    expect(DEFAULT_COPY_GROUP_IDS).not.toContain('framing');
    const values = pickRecipeValues(recipe, DEFAULT_COPY_GROUP_IDS);
    expect(values['tone.exposure']).toBe(0.7);
    expect(Object.keys(values).some((k) => k.startsWith('framing.'))).toBe(false);
  });

  it('copies only the chosen groups, crop included when asked', () => {
    const values = pickRecipeValues(recipe, ['framing']);
    expect(values['framing.rotate']).toBe(90);
    expect(values['framing.crop']).toEqual({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
    expect(values['tone.exposure']).toBeUndefined();
  });

  it('names the paste', () => {
    expect(pasteLabel({ values: {}, groupIds: DEFAULT_COPY_GROUP_IDS, sourceName: 'a' })).toBe('Paste edits');
    expect(pasteLabel({ values: {}, groupIds: ['tone', 'framing'], sourceName: 'a' })).toBe('Paste tone, framing');
    expect(asGroupIds(['tone', 'nonsense', 'framing'])).toEqual(['tone', 'framing']);
  });

  it('pastes as one applyRecipeValues call', () => {
    const calls: string[] = [];
    const values: Record<string, Json> = { 'tone.exposure': 0.7 };
    const session = {
      applyRecipeValues: (ids: string[], _v: unknown, label: string) => calls.push(`${ids.join(',')} ${label}`),
    } as unknown as LibrarySession;
    pasteRecipeValues(session, ['v1', 'v2'], { values, groupIds: ['tone'], sourceName: 'a' });
    pasteRecipeValues(session, [], { values, groupIds: ['tone'], sourceName: 'a' });
    expect(calls).toEqual(['v1,v2 Paste tone']);
  });
});
