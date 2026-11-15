import { useNotificationsStore } from '../../app/notifications-store';
import styles from './Toasts.module.css';

export function Toasts() {
  const notifications = useNotificationsStore((s) => s.notifications);
  const dismiss = useNotificationsStore((s) => s.dismiss);

  if (notifications.length === 0) return null;

  return (
    <div className={styles.container} role="status" aria-live="polite">
      {notifications.map((n) => (
        <div key={n.id} className={`${styles.toast} ${styles[n.level]}`}>
          <span className={styles.message}>{n.message}</span>
          <button
            className={styles.dismiss}
            onClick={() => dismiss(n.id)}
            aria-label="Dismiss"
            type="button"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
