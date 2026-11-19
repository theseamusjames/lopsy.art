import { CommandError } from '../command';
import { defineCommand } from '../registry';
import { requireDocument } from '../context';
import { useUIStore, type Guide } from '../../app/ui-store';

export interface GuideJSON {
  id: string;
  orientation: Guide['orientation'];
  /** Document pixels: a column for a vertical guide, a row for a horizontal one. */
  position: number;
}

function guides(): Guide[] {
  return useUIStore.getState().guides;
}

function guideJson(guide: Guide): GuideJSON {
  return { id: guide.id, orientation: guide.orientation, position: guide.position };
}

const orientationSpec = {
  type: 'string',
  enum: ['horizontal', 'vertical'],
  description: 'horizontal: a guide across the canvas at a row (a click on the left ruler). vertical: a guide down the canvas at a column (a click on the top ruler).',
} as const;

const positionSpec = {
  type: 'number',
  description: 'Document pixels from the top (horizontal) or left (vertical) edge; fractions are kept, as a ruler click keeps them.',
} as const;

function findGuide(id: string | undefined, orientation: string | undefined, position: number | undefined): Guide {
  if (id !== undefined) {
    if (orientation !== undefined || position !== undefined) {
      throw new CommandError('invalid', 'guide.remove: pass either guide, or orientation and position, not both');
    }
    const byId = guides().find((g) => g.id === id);
    if (!byId) throw new CommandError('not-found', `No guide has the id ${JSON.stringify(id)}.`);
    return byId;
  }
  if (orientation === undefined || position === undefined) {
    throw new CommandError('invalid', 'guide.remove: pass guide (an id from guide.list), or both orientation and position');
  }
  const match = guides().find((g) => g.orientation === orientation && g.position === position);
  if (!match) throw new CommandError('not-found', `No ${orientation} guide is at ${position}.`);
  return match;
}

export const guideList = defineCommand({
  id: 'guide.list',
  summary: 'Lists the ruler guides in the order they were added, each with its id, orientation and position in document pixels. Changes nothing.',
  surface: 'document',
  params: {},
  run(): { guides: GuideJSON[] } {
    requireDocument();
    return { guides: guides().map(guideJson) };
  },
});

export const guideAdd = defineCommand({
  id: 'guide.add',
  summary:
    'Adds a ruler guide at an exact position, as a click on a ruler does (no history step; guides are not part of undo). A Cmd/Ctrl ruler click snaps to a fraction of the canvas first: pass the position you want instead. Returns the new guide.',
  surface: 'document',
  params: { orientation: orientationSpec, position: positionSpec },
  run({ orientation, position }): GuideJSON {
    requireDocument();
    useUIStore.getState().addGuide(orientation, position);
    const list = guides();
    const added = list[list.length - 1];
    if (!added) throw new Error('guide.add: no guide was added');
    return guideJson(added);
  },
});

export const guideRemove = defineCommand({
  id: 'guide.remove',
  summary:
    'Removes one ruler guide, as a click on it in the ruler does (no history step): pass its id, or its orientation and exact position. Returns the removed guide.',
  surface: 'document',
  params: {
    guide: { type: 'string', optional: true, description: 'A guide id from guide.list or guide.add.' },
    orientation: { ...orientationSpec, optional: true },
    position: { ...positionSpec, optional: true },
  },
  run({ guide: id, orientation, position }): GuideJSON {
    requireDocument();
    const guide = findGuide(id, orientation, position);
    useUIStore.getState().removeGuide(guide.id);
    return guideJson(guide);
  },
});

export const guideClear = defineCommand({
  id: 'guide.clear',
  summary: 'Removes every ruler guide, as Edit > Clear Guides does (no history step). Refused when there are none, where the menu does nothing. Returns how many it removed.',
  surface: 'document',
  params: {},
  run(): { removed: number } {
    requireDocument();
    const removed = guides().length;
    if (removed === 0) throw new CommandError('refused', 'There are no guides to clear.');
    useUIStore.getState().clearGuides();
    return { removed };
  },
});
