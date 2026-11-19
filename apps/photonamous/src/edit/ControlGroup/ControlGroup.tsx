import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import { EditSlider, type SliderReadout } from '../EditSlider/EditSlider';
import { defaultAt, isGroupDefault, numberAt, rangeOf, type ControlDef, type GroupDef } from '../edit-controls';
import styles from './ControlGroup.module.css';

export interface ControlGroupProps {
  readonly group: GroupDef;
  /** The recipe the sliders show, including a drag in progress. */
  readonly recipe: Recipe;
  readonly isDisabled: boolean;
  readonly onChange: (control: ControlDef, value: number) => void;
  readonly onCommit: (control: ControlDef, value: number) => void;
  readonly onReset: (group: GroupDef) => void;
  /** Shows an Auto button in the header that calls this. */
  readonly onAuto?: () => void;
  /** What Auto does, for its tooltip. */
  readonly autoTitle?: string;
  /** The Auto button's text, when it does something else ('Level'). */
  readonly autoLabel?: string;
  /** Readouts in other units, by control path (Temperature in Kelvin for RAW). */
  readonly displays?: Readonly<Record<string, SliderReadout>>;
  /** Why the controls are disabled, shown under the heading. */
  readonly note?: string;
  /** Rows shown under the heading, above the sliders (White balance's mode and picker). */
  readonly children?: ReactNode;
}

export function ControlGroup({ group, recipe, isDisabled, onChange, onCommit, onReset, onAuto, autoTitle, autoLabel = 'Auto', displays, note, children }: ControlGroupProps) {
  const isDefault = isGroupDefault(recipe, group);
  return (
    <section className={styles.group} aria-label={group.title}>
      <header className={styles.header}>
        <h2 className={styles.title}>{group.title}</h2>
        {onAuto && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.actionButton}
              aria-label={`${autoLabel} ${group.title}`}
              title={autoTitle}
              disabled={isDisabled}
              onClick={onAuto}
            >
              {autoLabel}
            </button>
          </div>
        )}
        <button
          type="button"
          className={styles.reset}
          aria-label={`Reset ${group.title}`}
          title={`Reset ${group.title}`}
          disabled={isDisabled || isDefault}
          onClick={() => onReset(group)}
        >
          <RotateCcw size={14} aria-hidden />
        </button>
      </header>
      {note && (
        <p className={styles.note} role="status">
          {note}
        </p>
      )}
      {children}
      <div className={styles.controls}>
        {group.controls.map((control) => {
          const range = rangeOf(control.path);
          return (
            <EditSlider
              key={control.path}
              label={control.label}
              value={numberAt(recipe, control.path)}
              min={range.min}
              max={range.max}
              step={range.step}
              defaultValue={defaultAt(control.path)}
              disabled={isDisabled}
              onChange={(v) => onChange(control, v)}
              onCommit={(v) => onCommit(control, v)}
              {...displays?.[control.path]}
              {...(control.unit ? { unit: control.unit } : {})}
            />
          );
        })}
      </div>
    </section>
  );
}
