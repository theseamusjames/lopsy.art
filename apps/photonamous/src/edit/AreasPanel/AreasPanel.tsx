import { useState } from 'react';
import { Circle, FlipVertical, Plus, Trash2 } from 'lucide-react';
import { MAX_AREAS, liveAreas, type AreaKind, type Recipe } from '@lopsy/photos-core/library/recipe';
import { Slider } from '../../components/Slider/Slider';
import { AREA_SLIDERS, areaLabel } from '../area-edit';
import { defaultAt, numberAt, rangeOf, type ControlDef } from '../edit-controls';
import styles from './AreasPanel.module.css';

export interface AreasPanelProps {
  /** The recipe the sliders show, a drag in progress included. */
  readonly recipe: Recipe;
  readonly selectedId: string | null;
  readonly isDisabled: boolean;
  readonly onAdd: (kind: AreaKind) => void;
  readonly onSelect: (areaId: string | null) => void;
  readonly onRename: (areaId: string, name: string) => void;
  readonly onInvert: (areaId: string, isInverted: boolean) => void;
  readonly onDelete: (areaId: string) => void;
  readonly onChange: (control: ControlDef, value: number) => void;
  readonly onCommit: (control: ControlDef, value: number) => void;
}

/** Areas (spec 5.4): the list, adding and removing, and the chosen area's own sliders. */
export function AreasPanel({ recipe, selectedId, isDisabled, onAdd, onSelect, onRename, onInvert, onDelete, onChange, onCommit }: AreasPanelProps) {
  const areas = liveAreas(recipe);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const isFull = areas.length >= MAX_AREAS;
  const selectedIndex = areas.findIndex((a) => a.id === selectedId);
  const selected = areas[selectedIndex];

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
    <section className={styles.panel} aria-label="Areas">
      <header className={styles.header}>
        <h2 className={styles.title}>Areas</h2>
        <div className={styles.add}>
          <button type="button" className={styles.button} disabled={isDisabled || isFull} onClick={() => onAdd('linear')} title="A gradient across the photo">
            <Plus size={13} aria-hidden />
            <span>Linear</span>
          </button>
          <button type="button" className={styles.button} disabled={isDisabled || isFull} onClick={() => onAdd('radial')} title="An ellipse">
            <Circle size={13} aria-hidden />
            <span>Radial</span>
          </button>
        </div>
      </header>
      {areas.length === 0 && <p className={styles.empty}>Add a linear or radial area to adjust part of the photo.</p>}
      <ul className={styles.list} aria-label="Area list">
        {areas.map((area, i) => {
          const label = areaLabel(area, i);
          const isSelected = area.id === selectedId;
          return (
            <li key={area.id} className={styles.row}>
              {renaming?.id === area.id ? (
                <form
                  className={styles.rename}
                  onSubmit={(e) => {
                    e.preventDefault();
                    onRename(area.id, renaming.name.trim());
                    setRenaming(null);
                  }}
                >
                  <input
                    className={styles.input}
                    aria-label="Area name"
                    value={renaming.name}
                    autoFocus
                    maxLength={60}
                    onChange={(e) => setRenaming({ id: area.id, name: e.currentTarget.value })}
                    onBlur={() => setRenaming(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                </form>
              ) : (
                <button
                  type="button"
                  className={styles.area}
                  aria-current={isSelected ? 'true' : undefined}
                  disabled={isDisabled}
                  onClick={() => onSelect(isSelected ? null : area.id)}
                  onDoubleClick={() => setRenaming({ id: area.id, name: area.name })}
                >
                  <span className={styles.kind}>{area.kind === 'linear' ? 'Linear' : 'Radial'}</span>
                  <span>{label}</span>
                </button>
              )}
              <button
                type="button"
                className={styles.icon}
                aria-label={`Invert ${label}`}
                aria-pressed={area.invert}
                title="Invert"
                disabled={isDisabled}
                onClick={() => onInvert(area.id, !area.invert)}
              >
                <FlipVertical size={13} aria-hidden />
              </button>
              <button type="button" className={styles.icon} aria-label={`Delete ${label}`} title="Delete" disabled={isDisabled} onClick={() => onDelete(area.id)}>
                <Trash2 size={13} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {selected && (
        <div className={styles.controls} aria-label={`${areaLabel(selected, selectedIndex)} adjustments`} role="group">
          {slider({ path: `areas.${selected.id}.amount`, label: 'Amount', historyLabel: `${areaLabel(selected, selectedIndex)} amount` })}
          {AREA_SLIDERS.map((s) =>
            slider({
              path: `areas.${selected.id}.adjustments.${s.key}`,
              label: s.label,
              historyLabel: `${areaLabel(selected, selectedIndex)} ${s.label.toLowerCase()}`,
            }),
          )}
        </div>
      )}
    </section>
  );
}
