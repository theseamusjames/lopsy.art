import { applyBooleanOp } from '../../path-boolean-ops';
import type { MenuDef } from './types';

export function createPathMenu(): MenuDef {
  return {
    label: 'Path',
    items: [
      {
        label: 'Unite Paths',
        action: () => applyBooleanOp('union'),
      },
      {
        label: 'Subtract Paths',
        action: () => applyBooleanOp('subtract'),
      },
      {
        label: 'Intersect Paths',
        action: () => applyBooleanOp('intersect'),
      },
      {
        label: 'Exclude Paths',
        action: () => applyBooleanOp('exclude'),
      },
    ],
  };
}
