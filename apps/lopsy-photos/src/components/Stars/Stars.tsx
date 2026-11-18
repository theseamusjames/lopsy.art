import { Star } from 'lucide-react';
import type { Rating } from '@lopsy/photos-core/library/types';
import styles from './Stars.module.css';

interface StarsProps {
  rating: Rating;
  /** Without it the stars only show the rating. Clicking the current rating clears it. */
  onChange?: (rating: Rating) => void;
  size?: number;
  /** Shown when ratings differ across a selection. */
  mixed?: boolean;
}

const LEVELS: Rating[] = [1, 2, 3, 4, 5];

export function Stars({ rating, onChange, size = 12, mixed = false }: StarsProps) {
  if (!onChange) {
    return (
      <span className={styles.stars} aria-label={`${rating} star${rating === 1 ? '' : 's'}`}>
        {LEVELS.filter((n) => n <= rating).map((n) => (
          <Star key={n} size={size} className={styles.on} />
        ))}
      </span>
    );
  }
  return (
    <span className={styles.stars} role="radiogroup" aria-label="Rating" data-mixed={mixed}>
      {LEVELS.map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={rating === n}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
          title={rating === n ? 'Clear the rating' : `${n} star${n === 1 ? '' : 's'}`}
          className={styles.button}
          onClick={() => onChange(rating === n ? 0 : n)}
        >
          <Star size={size} className={n <= rating ? styles.on : styles.off} />
        </button>
      ))}
    </span>
  );
}
