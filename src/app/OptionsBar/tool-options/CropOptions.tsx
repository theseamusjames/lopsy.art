import { AspectRatioControl } from './AspectRatioControl';
import styles from '../OptionsBar.module.css';

export function CropOptions() {
  return (
    <>
      <span className={styles.hint}>Drag to select crop area</span>
      <div className={styles.separator} />
      <AspectRatioControl />
    </>
  );
}
