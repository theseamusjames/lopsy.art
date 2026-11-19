import type { HistoryStep } from '@lopsy/photos-core/library/types';
import { ORIGINAL_STEP_ID, currentStepId } from '../history-nav';
import styles from './HistoryPanel.module.css';

export interface HistoryPanelProps {
  /** Oldest first. */
  readonly history: readonly HistoryStep[];
  readonly isDisabled: boolean;
  /** Go to a step (or ORIGINAL_STEP_ID): undoing and redoing, never deleting. */
  readonly onGoTo: (stepId: string) => void;
}

/**
 * Every step of the version's history; clicking one goes back (or forward)
 * to it. The current step is marked, and undone ones say so in words as
 * well as in italics.
 */
export function HistoryPanel({ history, isDisabled, onGoTo }: HistoryPanelProps) {
  const current = currentStepId(history);
  const rows = [{ id: ORIGINAL_STEP_ID, label: 'Original', active: true }, ...history];
  return (
    <ol className={styles.list} aria-label="History" data-testid="history-list">
      {[...rows].reverse().map((step) => (
        <li key={step.id || 'original'}>
          <button
            type="button"
            className={styles.step}
            aria-current={step.id === current ? 'step' : undefined}
            data-undone={!step.active || undefined}
            disabled={isDisabled}
            onClick={() => onGoTo(step.id)}
          >
            {step.label}
            {!step.active && <span className={styles.srOnly}> (undone)</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}
