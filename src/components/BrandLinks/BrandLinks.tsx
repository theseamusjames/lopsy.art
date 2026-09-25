import styles from './BrandLinks.module.css';

export const TUTORIALS_URL = '/tutorials/';

export function BrandLinks() {
  return (
    <div className={styles.brandLinks}>
      {/* A new tab so an open document isn't lost by navigating away. */}
      <a className={styles.link} href={TUTORIALS_URL} target="_blank" rel="noopener">
        Tutorials
      </a>
      <span className={styles.logo} aria-hidden="true">LOPSY</span>
    </div>
  );
}
