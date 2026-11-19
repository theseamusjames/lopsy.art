import { useEffect, useRef, useState } from 'react';
import { Circle, FlipVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { MAX_AREAS, liveAreas, type Area, type AreaKind, type LinearGeometry, type RadialGeometry, type Recipe } from '@lopsy/photos-core/library/recipe';
import { Slider, type SliderDisplay } from '../../components/Slider/Slider';
import type { AreaFrame } from '../../engine/areas';
import { AREA_SLIDERS, areaLabel } from '../area-edit';
import { formatShape, parseShape, shapeControls, shapeValue, withShapeValue, type AreaShapeControl, type DocSize, type ShapeUnit } from '../area-shape';
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
  /** Where the photo is, for the selected area's shape sliders; they show once it is known. */
  readonly shapeFrame?: { readonly frame: AreaFrame; readonly doc: DocSize } | null;
  /** While a shape slider moves. */
  readonly onShapeChange?: (areaId: string, geometry: LinearGeometry | RadialGeometry) => void;
  /** Once, when it is let go. */
  readonly onShapeCommit?: (areaId: string, geometry: LinearGeometry | RadialGeometry, label: string) => void;
}

/** Where focus goes once a rename or a delete has re-rendered the list. */
type FocusTarget = { readonly kind: 'area'; readonly id: string } | { readonly kind: 'add' };

const DISPLAYS: Readonly<Record<ShapeUnit, SliderDisplay>> = {
  percent: { format: (v) => formatShape(v, 'percent'), parse: parseShape },
  degrees: { format: (v) => formatShape(v, 'degrees'), parse: parseShape },
};

/** Areas (spec 5.4): the list, adding and removing, and the chosen area's shape and its own sliders. */
export function AreasPanel({
  recipe,
  selectedId,
  isDisabled,
  onAdd,
  onSelect,
  onRename,
  onInvert,
  onDelete,
  onChange,
  onCommit,
  shapeFrame,
  onShapeChange,
  onShapeCommit,
}: AreasPanelProps) {
  const areas = liveAreas(recipe);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [focusAfter, setFocusAfter] = useState<FocusTarget | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const isFull = areas.length >= MAX_AREAS;
  const selectedIndex = areas.findIndex((a) => a.id === selectedId);
  const selected = areas[selectedIndex];

  useEffect(() => {
    if (!focusAfter) return;
    const panel = panelRef.current;
    const target =
      focusAfter.kind === 'add'
        ? panel?.querySelector<HTMLElement>('[data-area-add]')
        : panel?.querySelector<HTMLElement>(`[data-area-id="${CSS.escape(focusAfter.id)}"]`);
    target?.focus();
    setFocusAfter(null);
  }, [focusAfter]);

  const finishRename = (area: Area, name: string | null) => {
    if (name !== null) onRename(area.id, name.trim());
    setRenaming(null);
    setFocusAfter({ kind: 'area', id: area.id });
  };

  const handleDelete = (index: number) => {
    const area = areas[index];
    if (!area) return;
    const neighbour = areas[index + 1] ?? areas[index - 1];
    onDelete(area.id);
    setFocusAfter(neighbour ? { kind: 'area', id: neighbour.id } : { kind: 'add' });
  };

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

  const shapeSlider = (area: Area, frame: AreaFrame, doc: DocSize, control: AreaShapeControl) => (
    <Slider
      key={control.key}
      label={control.label}
      value={shapeValue(area, frame, doc, control.key)}
      min={control.min}
      max={control.max}
      step={control.step}
      defaultValue={control.defaultValue}
      isDisabled={isDisabled}
      display={DISPLAYS[control.unit]}
      onChange={(v) => onShapeChange?.(area.id, withShapeValue(area, frame, doc, control.key, v))}
      onCommit={(v) => onShapeCommit?.(area.id, withShapeValue(area, frame, doc, control.key, v), control.historyLabel)}
    />
  );

  return (
    <section ref={panelRef} className={styles.panel} aria-label="Areas">
      <header className={styles.header}>
        <h2 className={styles.title}>Areas</h2>
        <div className={styles.add}>
          <button
            type="button"
            className={styles.button}
            disabled={isDisabled || isFull}
            onClick={() => onAdd('linear')}
            title="A gradient across the photo"
            data-area-add
          >
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
                    finishRename(area, renaming.name);
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
                      if (e.key !== 'Escape') return;
                      e.preventDefault();
                      finishRename(area, null);
                    }}
                  />
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.area}
                    aria-current={isSelected ? 'true' : undefined}
                    disabled={isDisabled}
                    data-area-id={area.id}
                    onClick={() => onSelect(isSelected ? null : area.id)}
                    onDoubleClick={() => setRenaming({ id: area.id, name: area.name })}
                  >
                    <span className={styles.kind}>{area.kind === 'linear' ? 'Linear' : 'Radial'}</span>
                    <span>{label}</span>
                  </button>
                  <button
                    type="button"
                    className={styles.icon}
                    aria-label={`Rename ${label}`}
                    title="Rename"
                    disabled={isDisabled}
                    onClick={() => setRenaming({ id: area.id, name: area.name })}
                  >
                    <Pencil size={13} aria-hidden />
                  </button>
                </>
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
              <button type="button" className={styles.icon} aria-label={`Delete ${label}`} title="Delete" disabled={isDisabled} onClick={() => handleDelete(i)}>
                <Trash2 size={13} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {selected && shapeFrame && (
        <div className={styles.controls} aria-label={`${areaLabel(selected, selectedIndex)} shape`} role="group">
          {shapeControls(selected).map((control) => shapeSlider(selected, shapeFrame.frame, shapeFrame.doc, control))}
        </div>
      )}
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
