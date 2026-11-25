import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { RECIPE_GROUPS, type Recipe, type RecipeGroupId } from '@lopsy/photos-core/library/recipe';
import type { Preset, PresetId } from '@lopsy/photos-core/library/types';
import { changedGroups } from '../edit-controls';
import styles from './PresetsPanel.module.css';

export interface PresetsPanelProps {
  /** The library's presets, without deleted ones: the ones it started with and the user's own, alike. */
  readonly presets: readonly Preset[];
  /** The edit a new preset is saved from. */
  readonly recipe: Recipe;
  readonly isDisabled: boolean;
  /** Clicking applies a preset as one step. */
  readonly onApply: (preset: Preset) => void;
  /** Hovering previews a preset on the image; null when the pointer leaves. */
  readonly onPreview: (preset: Preset | null) => void;
  readonly onSave?: (name: string, groups: readonly RecipeGroupId[]) => void;
  readonly onDelete?: (presetId: PresetId) => void;
}

/** Where focus goes once the list has re-rendered: a preset, or Save preset…. */
type FocusTarget = { readonly kind: 'preset'; readonly id: PresetId } | { readonly kind: 'add' };

/** Presets (spec 5.4): hover or focus to preview, click to apply, save the current edit's groups as a new one. */
export function PresetsPanel({ presets, recipe, isDisabled, onApply, onPreview, onSave, onDelete }: PresetsPanelProps) {
  const [form, setForm] = useState<{ name: string; groups: ReadonlySet<RecipeGroupId> } | null>(null);
  const [focusAfter, setFocusAfter] = useState<FocusTarget | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusAfter) return;
    const selector = focusAfter.kind === 'add' ? '[data-preset-add]' : `[data-preset-id="${CSS.escape(focusAfter.id)}"]`;
    rootRef.current?.querySelector<HTMLElement>(selector)?.focus();
    setFocusAfter(null);
  }, [focusAfter]);

  const closeForm = () => {
    setForm(null);
    setFocusAfter({ kind: 'add' });
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form || !onSave) return;
    const name = form.name.trim();
    if (!name || form.groups.size === 0) return;
    onSave(name, RECIPE_GROUPS.map((g) => g.id).filter((id) => form.groups.has(id)));
    closeForm();
  };

  const handleDelete = (index: number) => {
    const preset = presets[index];
    if (!preset || !onDelete) return;
    const neighbour = presets[index + 1] ?? presets[index - 1];
    onDelete(preset.id);
    setFocusAfter(neighbour ? { kind: 'preset', id: neighbour.id } : { kind: 'add' });
  };

  return (
    <div ref={rootRef} className={styles.presets}>
      <ul className={styles.list} aria-label="Presets" onPointerLeave={() => onPreview(null)}>
        {presets.map((p, i) => (
          <li key={p.id} className={styles.row}>
            <button
              type="button"
              className={styles.preset}
              disabled={isDisabled}
              data-preset-id={p.id}
              onPointerEnter={() => onPreview(p)}
              onFocus={() => onPreview(p)}
              onBlur={() => onPreview(null)}
              onClick={() => {
                onPreview(null);
                onApply(p);
              }}
            >
              {p.name}
            </button>
            {onDelete && (
              <button type="button" className={styles.icon} aria-label={`Delete preset ${p.name}`} disabled={isDisabled} onClick={() => handleDelete(i)}>
                <Trash2 size={13} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {onSave &&
        (form ? (
          <form
            className={styles.form}
            onSubmit={handleSubmit}
            aria-label="Save preset"
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              closeForm();
            }}
          >
            <input
              className={styles.input}
              aria-label="Preset name"
              value={form.name}
              autoFocus
              maxLength={80}
              onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
            />
            <fieldset className={styles.groups}>
              <legend className={styles.legend}>Groups</legend>
              {RECIPE_GROUPS.map((g) => (
                <label key={g.id} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={form.groups.has(g.id)}
                    onChange={(e) => {
                      const groups = new Set(form.groups);
                      if (e.currentTarget.checked) groups.add(g.id);
                      else groups.delete(g.id);
                      setForm({ ...form, groups });
                    }}
                  />
                  <span>{g.label}</span>
                </label>
              ))}
            </fieldset>
            <div className={styles.actions}>
              <button type="button" className={styles.small} onClick={closeForm}>
                Cancel
              </button>
              <button type="submit" className={styles.small} disabled={!form.name.trim() || form.groups.size === 0}>
                Save
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className={styles.add}
            disabled={isDisabled}
            data-preset-add
            onClick={() => setForm({ name: '', groups: new Set(changedGroups(recipe)) })}
          >
            <Plus size={14} aria-hidden />
            <span>Save preset…</span>
          </button>
        ))}
    </div>
  );
}
