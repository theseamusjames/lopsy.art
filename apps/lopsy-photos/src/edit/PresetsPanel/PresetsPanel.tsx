import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { RECIPE_GROUPS, type Recipe, type RecipeGroupId } from '@lopsy/photos-core/library/recipe';
import type { Preset, PresetId } from '@lopsy/photos-core/library/types';
import { changedGroups } from '../edit-controls';
import styles from './PresetsPanel.module.css';

export interface PresetsPanelProps {
  /** Built-in and the user's, without deleted ones. */
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

/** Presets (spec 5.4): hover to preview, click to apply, save the current edit's groups as a new one. */
export function PresetsPanel({ presets, recipe, isDisabled, onApply, onPreview, onSave, onDelete }: PresetsPanelProps) {
  const [form, setForm] = useState<{ name: string; groups: ReadonlySet<RecipeGroupId> } | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form || !onSave) return;
    const name = form.name.trim();
    if (!name || form.groups.size === 0) return;
    onSave(name, RECIPE_GROUPS.map((g) => g.id).filter((id) => form.groups.has(id)));
    setForm(null);
  };

  return (
    <div className={styles.presets}>
      <ul className={styles.list} aria-label="Presets" onPointerLeave={() => onPreview(null)}>
        {presets.map((p) => (
          <li key={p.id} className={styles.row}>
            <button
              type="button"
              className={styles.preset}
              disabled={isDisabled}
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
            {onDelete && !p.builtIn && (
              <button type="button" className={styles.icon} aria-label={`Delete preset ${p.name}`} disabled={isDisabled} onClick={() => onDelete(p.id)}>
                <Trash2 size={13} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
      {onSave &&
        (form ? (
          <form className={styles.form} onSubmit={handleSubmit} aria-label="Save preset">
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
              <button type="button" className={styles.small} onClick={() => setForm(null)}>
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
            onClick={() => setForm({ name: '', groups: new Set(changedGroups(recipe)) })}
          >
            <Plus size={14} aria-hidden />
            <span>Save preset…</span>
          </button>
        ))}
    </div>
  );
}
