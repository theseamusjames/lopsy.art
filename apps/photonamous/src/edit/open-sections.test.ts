import { describe, expect, it } from 'vitest';
import { loadOpenSections, saveOpenSections, toggled } from './open-sections';

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) };
}

describe('open sections', () => {
  it('starts with every section folded', () => {
    expect([...loadOpenSections(memory())]).toEqual([]);
    expect([...loadOpenSections(null)]).toEqual([]);
  });

  it('reads back what was saved', () => {
    const storage = memory();
    saveOpenSections(new Set(['tone', 'curves']), storage);
    expect([...loadOpenSections(storage)]).toEqual(['tone', 'curves']);
  });

  it('opens one section at a time', () => {
    const tone = toggled(new Set(), 'tone');
    expect([...tone]).toEqual(['tone']);
    const curves = toggled(tone, 'curves');
    expect([...curves]).toEqual(['curves']);
    expect([...toggled(curves, 'curves')]).toEqual([]);
  });

  it('folds only the one pressed where several were stored open', () => {
    const several = new Set(['tone', 'curves', 'finish']);
    expect([...toggled(several, 'curves')]).toEqual(['tone', 'finish']);
    expect([...toggled(several, 'color')]).toEqual(['color']);
  });

  it('ignores what it did not write', () => {
    expect([...loadOpenSections(memory({ 'photonamous.edit-sections': 'not json' }))]).toEqual([]);
    expect([...loadOpenSections(memory({ 'photonamous.edit-sections': '{"tone":true}' }))]).toEqual([]);
    expect([...loadOpenSections(memory({ 'photonamous.edit-sections': '["tone",3,null]' }))]).toEqual(['tone']);
  });
});
