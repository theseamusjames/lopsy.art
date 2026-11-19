import { formatChord, shortcutGroups } from '../../shortcuts/registry';
import { isMac } from '../../app/hooks';
import styles from './ShortcutHelp.module.css';

/** Every shortcut, listed from the registry, in a list that scrolls and so takes focus (arrows and Page Up/Down scroll it). */
export function ShortcutHelp() {
  return (
    <div className={styles.help} role="region" aria-label="Shortcut list" tabIndex={0}>
      {shortcutGroups().map(({ group, items }) => (
        <section key={group} className={styles.group}>
          <h3 className={styles.heading}>{group}</h3>
          <dl className={styles.list}>
            {items.map((s) => (
              <div key={s.id} className={styles.row}>
                <dt className={styles.keys}>
                  {s.chords.slice(0, 1).map((c) => (
                    <kbd key={c.key} className={styles.kbd}>
                      {formatChord(c, isMac)}
                    </kbd>
                  ))}
                </dt>
                <dd>{s.description}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
