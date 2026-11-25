import { describe, expect, it } from 'vitest';
import type { ExportPreset, Preset } from '@lopsy/photos-core/library/types';
import { BUILT_IN_EXPORT_PRESETS, BUILT_IN_PRESETS } from '@lopsy/photos-core/library/presets';
import { DEFAULT_EXPORT_SETTINGS } from '@lopsy/photos-core/export/types';
import { listExportPresets, listPresets } from './presets-list';

const mine = (id: string, name: string, deleted = false): Preset => ({ id, name, groups: ['tone'], values: {}, createdAt: '', deleted });
const mineExport = (id: string, name: string, deleted = false): ExportPreset => ({ id, name, settings: DEFAULT_EXPORT_SETTINGS, createdAt: '', deleted });

describe('preset lists', () => {
  it("is one list by name: the starters and the user's own together, without deleted ones", () => {
    const presets = new Map([
      ['b', mine('b', 'Portra')],
      ['a', mine('a', 'Dusk')],
      ['x', mine('x', 'Gone', true)],
    ]);
    expect(listPresets({ presets }).map((p) => p.name)).toEqual(['Cool', 'Dusk', 'Monochrome', 'Portra', 'Punchy', 'Soft matte', 'Warm']);
  });

  it('leaves out a starter the user deleted, and shows one they renamed under its new name', () => {
    const punchy = BUILT_IN_PRESETS.find((p) => p.id === 'builtin:punchy')!;
    const warm = BUILT_IN_PRESETS.find((p) => p.id === 'builtin:warm')!;
    const presets = new Map([
      [punchy.id, { ...punchy, deleted: true }],
      [warm.id, { ...warm, name: 'Amber' }],
    ]);
    expect(listPresets({ presets }).map((p) => p.name)).toEqual(['Amber', 'Cool', 'Monochrome', 'Soft matte']);
  });

  it('does the same for export presets', () => {
    const list = listExportPresets({ exportPresets: new Map([['e', mineExport('e', 'Print')]]) });
    expect(list.length).toBe(BUILT_IN_EXPORT_PRESETS.length + 1);
    expect(list.map((p) => p.name)).toEqual([...list.map((p) => p.name)].sort((a, b) => a.localeCompare(b)));
    expect(list.map((p) => p.name)).toContain('Print');
  });
});
