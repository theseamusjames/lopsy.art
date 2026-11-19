import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import { EditSlider } from '../EditSlider/EditSlider';
import { defaultAt, numberAt, rangeOf, resetChangesFor, type ControlDef, type TabDef } from '../edit-controls';
import { useTabs } from '../tabs';
import styles from './TabbedGroup.module.css';

export interface TabbedGroupProps {
  readonly title: string;
  readonly tabs: readonly TabDef[];
  /** Sliders below the tabs that every tab shares (Blending, Balance). */
  readonly sharedControls?: readonly ControlDef[];
  readonly recipe: Recipe;
  readonly isDisabled: boolean;
  readonly onChange: (control: ControlDef, value: number) => void;
  readonly onCommit: (control: ControlDef, value: number) => void;
  readonly onReset: (changes: Record<string, Json>, label: string) => void;
}

/** A control group whose sliders are split over tabs (Color by hue, Color Grading). */
export function TabbedGroup({ title, tabs, sharedControls = [], recipe, isDisabled, onChange, onCommit, onReset }: TabbedGroupProps) {
  const [tabId, setTabId] = useState(tabs[0]?.id ?? '');
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const allControls = [...tabs.flatMap((t) => t.controls), ...sharedControls];
  const resetChanges = resetChangesFor(recipe, allControls);
  const isDefault = Object.keys(resetChanges).length === 0;
  const { tabProps, panelProps } = useTabs(
    tabs.map((t) => t.id),
    tab?.id ?? '',
    setTabId,
  );

  const slider = (control: ControlDef) => {
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
        {...(control.unit ? { unit: control.unit } : {})}
      />
    );
  };

  return (
    <section className={styles.group} aria-label={title}>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
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
      </header>
      <div className={styles.tabs} role="tablist" aria-label={`${title} tabs`}>
        {tabs.map((t) => (
          <button key={t.id} type="button" className={styles.tab} {...tabProps(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.controls} {...panelProps}>
        {tab?.controls.map(slider)}
        {sharedControls.length > 0 && <div className={styles.shared}>{sharedControls.map(slider)}</div>}
      </div>
    </section>
  );
}
