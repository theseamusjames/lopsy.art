import { useNotificationsStore } from '../app/notifications-store';

/**
 * Empties the notifications list whenever something adds to it. The agent
 * page mounts no Toasts component, which is what dismisses them in the
 * editor, so without this every toast a command's wrapped function raises
 * would stay for the life of the page. Returns the unsubscribe.
 */
export function dropNotifications(): () => void {
  const clear = (): void => {
    if (useNotificationsStore.getState().notifications.length > 0) useNotificationsStore.setState({ notifications: [] });
  };
  clear();
  return useNotificationsStore.subscribe(clear);
}
