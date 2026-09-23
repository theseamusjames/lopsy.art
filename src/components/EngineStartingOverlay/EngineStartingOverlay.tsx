import styles from './EngineStartingOverlay.module.css';

/**
 * Shown over the canvas while the WebGL engine compiles its shaders. The
 * spinner is a CSS transform animation so it keeps turning on the
 * compositor while engine creation blocks the main thread.
 */
export function EngineStartingOverlay() {
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <div className={styles.card}>
        <span className={styles.spinner} aria-hidden="true" />
        Starting graphics engine…
      </div>
    </div>
  );
}
