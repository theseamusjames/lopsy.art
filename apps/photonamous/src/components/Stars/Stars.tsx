import { Star } from 'lucide-react';
import type { Rating } from '@lopsy/photos-core/library/types';
import { handleRadioKeys, radioTabIndex } from '../RadioGroup/radio-keys';
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

const starsName = (n: number) => `${n} star${n === 1 ? '' : 's'}`;

/** The rating as stars; with `onChange`, a radio group: one Tab stop, the arrow keys choose, Space on the chosen one clears it. */
export function Stars({ rating, onChange, size = 12, mixed = false }: StarsProps) {
  if (!onChange) {
    return (
      <span className={styles.stars} role="img" aria-label={starsName(rating)}>
        {LEVELS.filter((n) => n <= rating).map((n) => (
          <Star key={n} size={size} className={styles.on} />
        ))}
      </span>
    );
  }
  const checked = LEVELS.indexOf(rating);
  return (
    <span
      className={styles.stars}
      role="radiogroup"
      aria-label="Rating"
      data-mixed={mixed}
      onKeyDown={(e) =>
        handleRadioKeys(e, (index) => {
          const level = LEVELS[index];
          if (level !== undefined) onChange(level);
        })
      }
    >
      {LEVELS.map((n, index) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={rating === n}
          aria-label={starsName(n)}
          title={rating === n ? 'Clear the rating' : starsName(n)}
          tabIndex={radioTabIndex(index, checked)}
          className={styles.button}
          onClick={() => onChange(rating === n ? 0 : n)}
        >
          <Star size={size} className={n <= rating ? styles.on : styles.off} />
        </button>
      ))}
    </span>
  );
}
