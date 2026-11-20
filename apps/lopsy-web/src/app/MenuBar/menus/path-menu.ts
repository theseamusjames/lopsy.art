import { commandItem } from './command-item';
import type { MenuDef } from './types';

export function createPathMenu(): MenuDef {
  return {
    label: 'Path',
    items: [
      commandItem('Unite Paths', 'path.unite'),
      commandItem('Subtract Paths', 'path.subtract'),
      commandItem('Intersect Paths', 'path.intersect'),
      commandItem('Exclude Paths', 'path.exclude'),
    ],
  };
}
