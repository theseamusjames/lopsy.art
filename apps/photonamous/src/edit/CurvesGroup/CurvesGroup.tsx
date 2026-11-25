import { RotateCcw } from 'lucide-react';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import { CurvesControls } from '../CurvesControls/CurvesControls';
import { curvesResetChanges } from '../edit-controls';
import { EditSection, type SectionHide } from '../EditSection/EditSection';
import styles from './CurvesGroup.module.css';

export interface CurvesGroupProps {
  readonly recipe: Recipe;
  readonly isDisabled: boolean;
  /** Folded to its heading or open (EditSection). */
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  /** The section's eye (EditSection). The Edit view disables the controls while it is hidden. */
  readonly hide?: SectionHide | undefined;
  /** Live, while a point moves. */
  readonly onDraft: (changes: Record<string, Json>) => void;
  readonly onCommit: (changes: Record<string, Json>, label: string) => void;
}

/** The Curves section of the Edit panel: its heading, Reset and eye, over `CurvesControls`. */
export function CurvesGroup({ recipe, isDisabled, isOpen, onToggle, hide, onDraft, onCommit }: CurvesGroupProps) {
  const resetChanges = curvesResetChanges(recipe);
  const isDefault = Object.keys(resetChanges).length === 0;
  return (
    <EditSection
      title="Curves"
      isOpen={isOpen}
      onToggle={onToggle}
      isChanged={!isDefault}
      hide={hide}
      actions={
        <button
          type="button"
          className={styles.reset}
          aria-label="Reset Curves"
          title="Reset Curves"
          disabled={isDisabled || isDefault}
          onClick={() => onCommit(resetChanges, 'Reset Curves')}
        >
          <RotateCcw size={14} aria-hidden />
        </button>
      }
    >
      <CurvesControls
        curves={recipe.curves}
        pathOf={(channel) => `curves.${channel}`}
        historyLabel={(channel) => `Curves: ${channel}`}
        isDisabled={isDisabled}
        onDraft={onDraft}
        onCommit={onCommit}
      />
    </EditSection>
  );
}
