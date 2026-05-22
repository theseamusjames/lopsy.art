import { LevelsEditor } from '../LevelsEditor';
import { IDENTITY_LEVELS } from '../../../filters/levels';
import type { Levels } from '../../../filters/levels';
import type { LevelsNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';

export function LevelsControls({ node, onChange }: NodeControlProps<LevelsNode>) {
  const levels: Levels = node.levels;
  return (
    <LevelsEditor
      levels={levels}
      onChange={(newLevels) => onChange({ levels: newLevels })}
      onReset={() => onChange({ levels: IDENTITY_LEVELS })}
    />
  );
}
