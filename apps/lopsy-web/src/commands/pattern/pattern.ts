import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { refusalError } from '../refusal';
import { requireDocument, requireEngine } from '../context';
import { definePattern } from '../../app/MenuBar/pattern-actions';
import type { PatternDefinition } from '../../app/pattern-store';
import { pixelWriteRefusal } from '../../layers/paint-target';

export interface PatternResult {
  id: string;
  name: string;
  /** In pixels. */
  width: number;
  height: number;
}

function patternResult(pattern: PatternDefinition | null): PatternResult {
  if (!pattern) {
    throw new CommandError('refused', 'Nothing was captured: the active layer has no pixels inside the selection (or at all).');
  }
  return { id: pattern.id, name: pattern.name, width: pattern.width, height: pattern.height };
}

export const patternDefine = defineCommand({
  id: 'pattern.define',
  summary:
    'Captures the active layer\'s pixels inside the selection\'s bounds (masked by the selection), or the whole layer\'s texture with no selection, as a new pattern, as Edit > Define Pattern does (no history step); it becomes the pattern filter.pattern-fill uses when called without one. Refused on a text or group layer with the text the menu toasts. Returns the pattern\'s id, name and size in pixels.',
  surface: 'document',
  params: {
    name: {
      type: 'string',
      optional: true,
      minLength: 1,
      description: 'The pattern\'s name. Omitted means "Pattern N", numbered as the menu numbers them.',
    },
  },
  run({ name }): Promise<PatternResult> {
    const doc = requireDocument();
    const layer = doc.layers.find((l) => l.id === doc.activeLayerId);
    const refusal = pixelWriteRefusal(layer);
    if (refusal) throw refusalError(refusal);
    requireEngine();
    return definePattern(name).then(patternResult);
  },
});
