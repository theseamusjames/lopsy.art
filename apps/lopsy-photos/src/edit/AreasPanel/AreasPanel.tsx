import { useState } from 'react';
import { Circle, Minus, Trash2 } from 'lucide-react';
import { liveAreas, rangeForPath, type Area, type AreaKind, type Recipe } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import { Slider } from '../../components/Slider/Slider';
import { changeLabel } from '../edit-controls';
import styles from './AreasPanel.module.css';

/** The per-area adjustments the engine renders (local contrast is not rendered per area). */
export const AREA_CONTROLS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'exposure', label: 'Exposure' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'temperature', label: 'Temperature' },
  { key: 'tint', label: 'Tint' },
  { key: 'saturation', label: 'Saturation' },
];

/** What the list and history call an area: its name, else "Area <n>". */
export function areaTitle(area: Area, index: number): string {
  return area.name.trim() || `Area ${index + 1}`;
}

interface AreasPanelProps {
  /** The recipe shown, a drag in progress included. */
  recipe: Recipe;
  selectedId: string | null;
  isDisabled: boolean;
  onSelect: (id: string | null) => void;
  onAdd: (kind: AreaKind) => void;
  onDelete: (area: Area, title: string) => void;
  /** A value while it is dragged (not a history step). */
  onDraft: (changes: Readonly<Record<string, Json>>) => void;
  /** One history step. */
  onCommit: (changes: Readonly<Record<string, Json>>, label: string) => void;
}

/** Areas (spec 5.4): the list of linear and radial areas, and the selected one's settings. */
export function AreasPanel({ recipe, selectedId, isDisabled, onSelect, onAdd, onDelete, onDraft, onCommit }: AreasPanelProps) {
  const areas = liveAreas(recipe);
  const index = areas.findIndex((a) => a.id === selectedId);
  const selected = index >= 0 ? areas[index] ?? null : null;
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const slider = (
    title: string,
    path: string,
    label: string,
    value: number,
    defaultValue: number,
    toChanges: (v: number) => Readonly<Record<string, Json>> = (v) => ({ [path]: v }),
  ) => {
    const range = rangeForPath(path) ?? { min: -100, max: 100, step: 1 };
    return (
      <Slider
        key={path}
        label={label}
        value={value}
        min={range.min}
        max={range.max}
        step={range.step}
        defaultValue={defaultValue}
        isDisabled={isDisabled}
        onChange={(v) => onDraft(toChanges(v))}
        onCommit={(v) => onCommit(toChanges(v), changeLabel(`${title} ${label.toLowerCase()}`, path, v))}
      />
    );
  };

  return (
    <section className={styles.panel} aria-label="Areas">
      <header className={styles.header}>
        <h3 className={styles.title}>Areas</h3>
        <button type="button" className={styles.add} disabled={isDisabled || areas.length >= 8} onClick={() => onAdd('linear')}>
          <Minus size={14} aria-hidden />
          Linear
        </button>
        <button type="button" className={styles.add} disabled={isDisabled || areas.length >= 8} onClick={() => onAdd('radial')}>
          <Circle size={14} aria-hidden />
          Radial
        </button>
      </header>
      {areas.length === 0 ? (
        <p className={styles.hint}>Add a linear or radial area to adjust part of the photo.</p>
      ) : (
        <ul className={styles.list} aria-label="Area list">
          {areas.map((area, i) => (
            <li key={area.id}>
              <button
                type="button"
                className={styles.item}
                aria-pressed={area.id === selectedId}
                disabled={isDisabled}
                onClick={() => onSelect(area.id === selectedId ? null : area.id)}
              >
                {area.kind === 'radial' ? <Circle size={12} aria-hidden /> : <Minus size={12} aria-hidden />}
                {areaTitle(area, i)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className={styles.settings} aria-label={areaTitle(selected, index)} role="group">
          <div className={styles.row}>
            <input
              className={styles.name}
              aria-label="Area name"
              value={nameDraft ?? selected.name}
              placeholder={`Area ${index + 1}`}
              disabled={isDisabled}
              onChange={(e) => setNameDraft(e.currentTarget.value)}
              onBlur={() => {
                if (nameDraft !== null && nameDraft !== selected.name) {
                  onCommit({ [`areas.${selected.id}.name`]: nameDraft.slice(0, 80) }, 'Area: rename');
                }
                setNameDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') {
                  setNameDraft(null);
                  e.currentTarget.blur();
                }
              }}
            />
            <button
              type="button"
              className={styles.iconButton}
              aria-label="Delete area"
              title="Delete area"
              disabled={isDisabled}
              onClick={() => onDelete(selected, areaTitle(selected, index))}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={selected.invert}
              disabled={isDisabled}
              onChange={(e) =>
                onCommit({ [`areas.${selected.id}.invert`]: e.currentTarget.checked }, `${areaTitle(selected, index)} invert`)
              }
            />
            Invert
          </label>
          {slider(areaTitle(selected, index), `areas.${selected.id}.amount`, 'Amount', selected.amount, 100)}
          {selected.kind === 'radial' &&
            slider(areaTitle(selected, index), `areas.${selected.id}.geometry.feather`, 'Feather', selected.geometry.feather, 50, (v) => ({
              // The geometry is one recipe value, so the whole of it is written.
              [`areas.${selected.id}.geometry`]: { ...selected.geometry, feather: v },
            }))}
          {AREA_CONTROLS.map((c) =>
            slider(
              areaTitle(selected, index),
              `areas.${selected.id}.adjustments.${c.key}`,
              c.label,
              selected.adjustments[c.key as keyof Area['adjustments']],
              0,
            ),
          )}
        </div>
      )}
    </section>
  );
}
