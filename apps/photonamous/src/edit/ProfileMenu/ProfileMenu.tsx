import { useId } from 'react';
import type { DevelopProfile } from '../../engine/profiles';
import { selectedProfile } from '../../engine/profiles';
import styles from './ProfileMenu.module.css';

export interface ProfileMenuProps {
  readonly profiles: readonly DevelopProfile[];
  /** The recipe's `profile.id`. */
  readonly profileId: string;
  readonly isDisabled: boolean;
  readonly onSelect: (profile: DevelopProfile) => void;
  /**
   * A quiet word about the photo's colour (the decoder's, when its colour
   * is only approximate): shown under the menu and read with it.
   */
  readonly note?: string | null;
}

/** The Profile group (spec 5.4): the look the photo is developed with. */
export function ProfileMenu({ profiles, profileId, isDisabled, onSelect, note = null }: ProfileMenuProps) {
  const selected = selectedProfile(profiles, profileId);
  const noteId = useId();
  return (
    <section className={styles.group} aria-label="Profile">
      <label className={styles.row}>
        <span className={styles.title}>Profile</span>
        <select
          className={styles.select}
          aria-label="Profile"
          aria-describedby={note ? noteId : undefined}
          value={selected?.id ?? ''}
          disabled={isDisabled || profiles.length === 0}
          onChange={(e) => {
            const next = profiles.find((p) => p.id === e.currentTarget.value);
            if (next) onSelect(next);
          }}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {note && (
        <p id={noteId} className={styles.note} data-testid="color-note">
          {note}
        </p>
      )}
    </section>
  );
}
