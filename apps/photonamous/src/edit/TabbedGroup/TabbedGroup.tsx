import { RotateCcw } from 'lucide-react';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import { resetChangesFor, type ControlDef, type TabDef } from '../edit-controls';
import { EditSection, type SectionHide } from '../EditSection/EditSection';
import { TabbedControls } from '../TabbedControls/TabbedControls';
import styles from './TabbedGroup.module.css';

export interface TabbedGroupProps {
  readonly title: string;
  readonly tabs: readonly TabDef[];
  /** Sliders below the tabs that every tab shares (Blending, Balance). */
  readonly sharedControls?: readonly ControlDef[];
  readonly recipe: Recipe;
  readonly isDisabled: boolean;
  /** Folded to its heading or open (EditSection). */
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  /** The section's eye (EditSection). The Edit view disables the controls while it is hidden. */
  readonly hide?: SectionHide | undefined;
  readonly onChange: (control: ControlDef, value: number) => void;
  readonly onCommit: (control: ControlDef, value: number) => void;
  readonly onReset: (changes: Record<string, Json>, label: string) => void;
  /** A tab's colour field moves: its hue and saturation together, while it is dragged. */
  readonly onFieldChange?: (changes: Record<string, Json>) => void;
  /** And once it is let go, as one step. */
  readonly onFieldCommit?: (changes: Record<string, Json>, label: string) => void;
}

/** A section of the Edit panel whose sliders are split over tabs (Color by hue, Color Grading): the heading, its Reset and eye, over `TabbedControls`. */
export function TabbedGroup({
  title,
  tabs,
  sharedControls = [],
  recipe,
  isDisabled,
  isOpen,
  onToggle,
  hide,
  onChange,
  onCommit,
  onReset,
  onFieldChange,
  onFieldCommit,
}: TabbedGroupProps) {
  const resetChanges = resetChangesFor(recipe, [...tabs.flatMap((t) => t.controls), ...sharedControls]);
  const isDefault = Object.keys(resetChanges).length === 0;
  return (
    <EditSection
      title={title}
      isOpen={isOpen}
      onToggle={onToggle}
      isChanged={!isDefault}
      hide={hide}
      actions={
        <button
          type="button"
          className={styles.reset}
          aria-label={`Reset ${title}`}
          title={`Reset ${title}`}
          disabled={isDisabled || isDefault}
          onClick={() => onReset(resetChanges, `Reset ${title}`)}
        >
          <RotateCcw size={14} aria-hidden />
        </button>
      }
    >
      <TabbedControls
        title={title}
        tabs={tabs}
        sharedControls={sharedControls}
        recipe={recipe}
        isDisabled={isDisabled}
        onChange={onChange}
        onCommit={onCommit}
        onFieldChange={onFieldChange}
        onFieldCommit={onFieldCommit}
      />
    </EditSection>
  );
}
