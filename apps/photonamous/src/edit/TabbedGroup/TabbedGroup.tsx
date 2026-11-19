import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import { Slider } from '../../components/Slider/Slider';
import { defaultAt, numberAt, rangeOf, resetChangesFor, type ControlDef, type TabDef } from '../edit-controls';
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

  const slider = (control: ControlDef) => {
    const range = rangeOf(control.path);
    return (
      <Slider
        key={control.path}
        label={control.label}
        value={numberAt(recipe, control.path)}
        min={range.min}
        max={range.max}
        step={range.step}
        defaultValue={defaultAt(control.path)}
        isDisabled={isDisabled}
        onChange={(v) => onChange(control, v)}
        onCommit={(v) => onCommit(control, v)}
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
          <button
            key={t.id}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={t.id === tab?.id}
            onClick={() => setTabId(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.controls} role="tabpanel">
        {tab?.controls.map(slider)}
        {sharedControls.length > 0 && <div className={styles.shared}>{sharedControls.map(slider)}</div>}
      </div>
    </section>
  );
}
