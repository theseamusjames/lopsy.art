/** Short messages at the bottom of the window. */

import { create } from 'zustand';

export interface Toast {
  readonly id: number;
  readonly message: string;
}

interface ToastState {
  readonly toasts: readonly Toast[];
  dismiss(id: number): void;
}

let nextId = 1;

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Shows a message for a few seconds; the same message twice in a row shows once. */
export function showToast(message: string, ms = 6000): void {
  const { toasts } = useToasts.getState();
  if (toasts.some((t) => t.message === message)) return;
  const id = nextId++;
  useToasts.setState({ toasts: [...toasts, { id, message }].slice(-3) });
  setTimeout(() => useToasts.getState().dismiss(id), ms);
}
