import { afterEach, describe, expect, it } from 'vitest';
import { notifyError, notifyInfo, useNotificationsStore } from '../app/notifications-store';
import { dropNotifications } from './drop-notifications';

afterEach(() => {
  useNotificationsStore.setState({ notifications: [] });
});

describe('dropNotifications', () => {
  it('drops each notification as it is raised, and what was there before', () => {
    notifyInfo('raised before');
    const stop = dropNotifications();
    expect(useNotificationsStore.getState().notifications).toEqual([]);
    for (let i = 0; i < 50; i++) notifyError(`refused ${i}`);
    notifyInfo('one more');
    expect(useNotificationsStore.getState().notifications).toEqual([]);
    stop();
  });

  it('stops once unsubscribed, leaving the store as the editor uses it', () => {
    const stop = dropNotifications();
    stop();
    notifyInfo('kept');
    expect(useNotificationsStore.getState().notifications.map((n) => n.message)).toEqual(['kept']);
    useNotificationsStore.getState().dismiss(useNotificationsStore.getState().notifications[0]!.id);
    expect(useNotificationsStore.getState().notifications).toEqual([]);
  });
});
