import type { DocumentState, GroupLayer } from '../../types';
import type { AdjustmentNodeType } from '../../types/adjustment-nodes';

/** Node types available in the Add menu. New types (color-balance, etc.) are
 *  listed with a "(coming soon)" suffix but are still addable — their controls
 *  will show a placeholder until GPU shaders are wired up. */
export const ADD_MENU_TYPES: AdjustmentNodeType[] = [
  'exposure',
  'contrast',
  'highlights-shadows',
  'saturation',
  'vignette',
  'curves',
  'levels',
  'hue-saturation',
  'color-balance',
  'color-grading',
  'invert',
  'black-white',
  'photo-filter',
  'channel-mixer',
  'gradient-map',
];

/** The group the Adjustments panel edits: the active layer when it is a group, else the document's root group. */
export function adjustmentsPanelGroup(document: DocumentState): GroupLayer | null {
  const activeId = document.activeLayerId;
  if (activeId) {
    const active = document.layers.find((l) => l.id === activeId);
    if (active?.type === 'group') return active as GroupLayer;
  }
  const rootId = document.rootGroupId;
  if (rootId) {
    const root = document.layers.find((l) => l.id === rootId);
    if (root?.type === 'group') return root as GroupLayer;
  }
  return null;
}
