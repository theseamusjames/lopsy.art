import styles from './BrandLinks.module.css';

export const TUTORIALS_URL = '/tutorials/';
export const BLOG_URL = '/blog/';

export function BrandLinks() {
  return (
    <div className={styles.brandLinks}>
      {/* New tabs so an open document isn't lost by navigating away. */}
      <a className={styles.link} href={TUTORIALS_URL} target="_blank" rel="noopener">
        Tutorials
      </a>
      <a className={styles.link} href={BLOG_URL} target="_blank" rel="noopener">
        Blog
      </a>
      <span className={styles.logo} aria-hidden="true">LOPSY</span>
    </div>
  );
}
