import styles from '../OptionsBar.module.css';

/**
 * Crop has no settings — just a hint. A real component (vs an inline span
 * in OptionsBar) keeps the registry uniform: every tool with an options bar
 * resolves to a ComponentType.
 */
export function CropOptions() {
  return <span className={styles.hint}>Drag to select crop area</span>;
}
