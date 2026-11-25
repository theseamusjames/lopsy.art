import { useState } from 'react';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import { ColorField } from '../ColorField/ColorField';
import { EditSlider } from '../EditSlider/EditSlider';
import { fineReadout } from '../EditSlider/readout';
import { defaultAt, numberAt, rangeOf, type ControlDef, type TabDef } from '../edit-controls';
import { useTabs } from '../tabs';
import styles from './TabbedControls.module.css';

export interface TabbedControlsProps {
  /** What the tabs are of ("Color Grading"): names the tab list. */
  readonly title: string;
  readonly tabs: readonly TabDef[];
  /** Sliders below the tabs that every tab shares (Blending, Balance). */
  readonly sharedControls?: readonly ControlDef[];
  readonly recipe: Recipe;
  readonly isDisabled: boolean;
  readonly onChange: (control: ControlDef, value: number) => void;
  readonly onCommit: (control: ControlDef, value: number) => void;
  /** A tab's colour field moves: its hue and saturation together, while it is dragged. */
  readonly onFieldChange?: ((changes: Record<string, Json>) => void) | undefined;
  /** And once it is let go, as one step. */
  readonly onFieldCommit?: ((changes: Record<string, Json>, label: string) => void) | undefined;
}

/**
 * Sliders split over tabs, with the sliders every tab shares under them: the
 * body of Color by hue and Color Grading in the Edit panel, and of a mask's
 * own colour grading. A tab with a colour field shows it above its sliders.
 */
export function TabbedControls({ title, tabs, sharedControls = [], recipe, isDisabled, onChange, onCommit, onFieldChange, onFieldCommit }: TabbedControlsProps) {
  const [tabId, setTabId] = useState(tabs[0]?.id ?? '');
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];
  const field = tab?.field;
  const { tabProps, panelProps } = useTabs(
    tabs.map((t) => t.id),
    tab?.id ?? '',
    setTabId,
  );

  const slider = (control: ControlDef) => {
    const range = rangeOf(control.path);
    // The field sets these two to a tenth: their boxes show and take it.
    const isFine = field !== undefined && (control.path === field.huePath || control.path === field.saturationPath);
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
        {...(isFine ? fineReadout(range) : {})}
      />
    );
  };

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label={`${title} tabs`}>
        {tabs.map((t) => (
          <button key={t.id} type="button" className={styles.tab} {...tabProps(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.controls} {...panelProps}>
        {field && onFieldChange && onFieldCommit && (
          <ColorField
            label={field.label}
            hue={numberAt(recipe, field.huePath)}
            saturation={numberAt(recipe, field.saturationPath)}
            isDisabled={isDisabled}
            onChange={(hue, saturation) => onFieldChange({ [field.huePath]: hue, [field.saturationPath]: saturation })}
            onCommit={(hue, saturation) => onFieldCommit({ [field.huePath]: hue, [field.saturationPath]: saturation }, field.historyLabel ?? field.label)}
          />
        )}
        {tab?.controls.map(slider)}
        {sharedControls.length > 0 && <div className={styles.shared}>{sharedControls.map(slider)}</div>}
      </div>
    </>
  );
}
