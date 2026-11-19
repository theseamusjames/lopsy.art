import { formatChord, shortcutGroups } from '../../shortcuts/registry';
import { isMac } from '../../app/hooks';
import styles from './ShortcutHelp.module.css';

/** Every shortcut, listed from the registry. */
export function ShortcutHelp() {
  return (
    <div className={styles.help}>
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
