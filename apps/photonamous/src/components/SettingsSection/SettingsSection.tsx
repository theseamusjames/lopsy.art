import { useId, type ReactNode } from 'react';
import styles from './SettingsSection.module.css';

interface SettingsSectionProps {
  readonly title: string;
  /** What the group sets; as a function, it is given the heading's id, for a radio group the heading names. */
  readonly children: ReactNode | ((headingId: string) => ReactNode);
}

/** One group of settings in a Settings panel: a heading and what it sets, divided from the group above. */
export function SettingsSection({ title, children }: SettingsSectionProps) {
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h4 className={styles.heading} id={headingId}>
        {title}
      </h4>
      {typeof children === 'function' ? children(headingId) : children}
    </section>
  );
}
