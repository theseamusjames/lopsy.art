import { create } from 'zustand';

export type NotificationLevel = 'error' | 'info';

export interface Notification {
  readonly id: number;
  readonly level: NotificationLevel;
  readonly message: string;
}

interface NotificationsState {
  notifications: readonly Notification[];
  notify: (level: NotificationLevel, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useNotificationsStore = create<NotificationsState>((set) => ({
  notifications: [],
  notify: (level, message) => {
    const id = nextId++;
    set((s) => ({ notifications: [...s.notifications, { id, level, message }] }));
  },
  dismiss: (id) => {
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) }));
  },
}));

export function notifyError(message: string): void {
  useNotificationsStore.getState().notify('error', message);
}

export function notifyInfo(message: string): void {
  useNotificationsStore.getState().notify('info', message);
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}
