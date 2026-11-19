import { useSyncExternalStore } from 'react';
import { characterKeysEnabled, setCharacterKeysEnabled, subscribeCharacterKeys } from '../../shortcuts/character-keys';
import styles from './CharacterKeysToggle.module.css';

/** Turns the one-key shortcuts on and off for this device (WCAG 2.1.4). */
export function CharacterKeysToggle() {
  const isEnabled = useSyncExternalStore(subscribeCharacterKeys, characterKeysEnabled);
  return (
    <label className={styles.option}>
      <input
        type="checkbox"
        checked={isEnabled}
        aria-describedby="character-keys-hint"
        onChange={(e) => setCharacterKeysEnabled(e.target.checked)}
      />
      <span>
        Single-key shortcuts
        <span id="character-keys-hint" className={styles.hint}>
          Keys such as 1–5, X, R and J act on their own, without Ctrl or ⌘. Turn them off if you use speech input or
          press keys by accident; shortcuts with Ctrl or ⌘, the arrow keys, Enter and Escape keep working.
        </span>
      </span>
    </label>
  );
}
