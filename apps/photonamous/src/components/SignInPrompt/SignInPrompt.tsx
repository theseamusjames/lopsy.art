import { LogIn } from 'lucide-react';
import { reconnect, useReconnecting } from '../../app/reconnect';
import { Button } from '../Button/Button';
import styles from './SignInPrompt.module.css';

export const RECONNECT_LABEL = 'Reconnect Google Drive';

/**
 * What waits for Google's sign-in, where the person is looking: one plain
 * sentence and the Reconnect button (the same one as the header's: one
 * press serves everything waiting). Not a live region: the header says
 * once that sign-in is needed.
 */
export function SignInPrompt({ sentence, size = 'sm' }: { sentence: string; size?: 'sm' | 'md' }) {
  const busy = useReconnecting();
  return (
    <div className={styles.prompt} data-size={size}>
      <LogIn size={16} className={styles.icon} aria-hidden />
      <span>{sentence}</span>
      <Button size="sm" variant="primary" aria-disabled={busy} onClick={reconnect}>
        {RECONNECT_LABEL}
      </Button>
    </div>
  );
}
