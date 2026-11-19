import { describe, expect, it } from 'vitest';
import type { ExportPreset, Preset } from '@lopsy/photos-core/library/types';
import { BUILT_IN_EXPORT_PRESETS, BUILT_IN_PRESETS } from '@lopsy/photos-core/library/presets';
import { DEFAULT_EXPORT_SETTINGS } from '@lopsy/photos-core/export/types';
import { listExportPresets, listPresets } from './presets-list';

const mine = (id: string, name: string, deleted = false): Preset => ({ id, name, groups: ['tone'], values: {}, createdAt: '', deleted });
const mineExport = (id: string, name: string, deleted = false): ExportPreset => ({ id, name, settings: DEFAULT_EXPORT_SETTINGS, createdAt: '', deleted });

describe('preset lists', () => {
  it("lists Lopsy's presets first, then the user's by name, without deleted ones", () => {
    const presets = new Map([
      ['b', mine('b', 'Warm')],
      ['a', mine('a', 'Cool')],
      ['x', mine('x', 'Gone', true)],
    ]);
    const list = listPresets({ presets });
    expect(list.slice(0, BUILT_IN_PRESETS.length)).toEqual(BUILT_IN_PRESETS);
    expect(list.slice(BUILT_IN_PRESETS.length).map((p) => p.name)).toEqual(['Cool', 'Warm']);
  });

  it('does the same for export presets', () => {
    const list = listExportPresets({ exportPresets: new Map([['e', mineExport('e', 'Print')]]) });
    expect(list.length).toBe(BUILT_IN_EXPORT_PRESETS.length + 1);
    expect(list.at(-1)?.name).toBe('Print');
  });
});
