/** Short messages at the bottom of the window. */

import { create } from 'zustand';

export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface Toast {
  readonly id: number;
  readonly message: string;
  /** A button beside the message ("Reload"). */
  readonly action?: ToastAction;
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

/**
 * Shows a message for a few seconds (`ms` null: until dismissed); the same
 * message twice in a row shows once. Returns the id for `dismissToast`.
 */
export function showToast(message: string, ms: number | null = 6000, action?: ToastAction): number {
  const { toasts } = useToasts.getState();
  const same = toasts.find((t) => t.message === message);
  if (same) return same.id;
  const id = nextId++;
  useToasts.setState({ toasts: [...toasts, { id, message, ...(action ? { action } : {}) }].slice(-3) });
  if (ms !== null) setTimeout(() => useToasts.getState().dismiss(id), ms);
  return id;
}

export function dismissToast(id: number): void {
  useToasts.getState().dismiss(id);
}
