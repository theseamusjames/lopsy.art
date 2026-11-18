import { X } from 'lucide-react';
import { useToasts } from '../../app/toasts';
import { Button } from '../Button/Button';
import { IconButton } from '../IconButton/IconButton';
import styles from './Toasts.module.css';

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className={styles.stack} role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast}>
          <span>{t.message}</span>
          {t.action && (
            <Button size="sm" variant="primary" onClick={t.action.run}>
              {t.action.label}
            </Button>
          )}
          <IconButton size="sm" label="Dismiss" icon={<X size={12} />} onClick={() => dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
