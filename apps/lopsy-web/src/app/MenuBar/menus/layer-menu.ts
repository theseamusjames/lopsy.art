import { commandItem } from './command-item';
import type { MenuDef } from './types';

export function createLayerMenu(): MenuDef {
  return {
    label: 'Layer',
    items: [
      commandItem('New Layer', 'ui.layer.new', undefined, '⇧⌘N'),
      commandItem('Duplicate Layer', 'ui.layer.duplicate', undefined, '⌘J'),
      commandItem('Group Layers', 'layer.group', undefined, '⌘G'),
      { separator: true, label: '' },
      commandItem('Adjustment Layer…', 'ui.layer.adjustment-layer'),
      { separator: true, label: '' },
      commandItem('Merge Down', 'layer.merge-down', undefined, '⌘E'),
      commandItem('Flatten Image', 'layer.flatten'),
    ],
  };
}
