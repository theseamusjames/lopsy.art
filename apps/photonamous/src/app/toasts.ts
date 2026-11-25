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
  /** Something went wrong: announced at once (an alert) rather than when the screen reader is free. */
  readonly isError?: boolean;
}

interface ToastState {
  readonly toasts: readonly Toast[];
  dismiss(id: number): void;
}

interface Timer {
  /** Milliseconds left before the toast goes. */
  remaining: number;
  startedAt: number;
  handle: ReturnType<typeof setTimeout> | null;
}

/** When the pointer leaves, a toast gets at least this long again, so it does not vanish the moment it is let go. */
const RESUME_MS = 2000;

let nextId = 1;
const timers = new Map<number, Timer>();
let isPaused = false;

function stopTimer(id: number): void {
  const timer = timers.get(id);
  if (timer?.handle) clearTimeout(timer.handle);
  timers.delete(id);
}

function runTimer(id: number, timer: Timer): void {
  timer.startedAt = Date.now();
  timer.handle = setTimeout(() => {
    timers.delete(id);
    useToasts.getState().dismiss(id);
  }, timer.remaining);
}

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  dismiss: (id) => {
    stopTimer(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

function show(message: string, ms: number | null, extra: { readonly action?: ToastAction; readonly isError?: boolean }): number {
  const same = useToasts.getState().toasts.find((t) => t.message === message);
  // A message with an action (Undo) is about the latest change: it replaces the older one, whose action would undo the wrong thing.
  if (same && !extra.action) return same.id;
  if (same) useToasts.getState().dismiss(same.id);
  const { toasts } = useToasts.getState();
  const id = nextId++;
  const kept = [...toasts, { id, message, ...extra }].slice(-3);
  for (const t of toasts) if (!kept.includes(t)) stopTimer(t.id);
  useToasts.setState({ toasts: kept });
  if (ms !== null) {
    const timer: Timer = { remaining: ms, startedAt: 0, handle: null };
    timers.set(id, timer);
    if (!isPaused) runTimer(id, timer);
  }
  return id;
}

/**
 * Shows a message for a few seconds (`ms` null: until dismissed); the same
 * message twice in a row shows once, unless it carries an action, which
 * replaces the older one. Returns the id for `dismissToast`.
 */
export function showToast(message: string, ms: number | null = 6000, action?: ToastAction): number {
  return show(message, ms, action ? { action } : {});
}

/** Shows an error the same way, announced at once, for longer by default. */
export function showErrorToast(message: string, ms: number | null = 12_000): number {
  return show(message, ms, { isError: true });
}

export function dismissToast(id: number): void {
  useToasts.getState().dismiss(id);
}

/**
 * Holds every toast on screen (WCAG 2.2.1) while the pointer is over them
 * or focus is in one, so there is time to read it and reach its button.
 */
export function pauseToasts(): void {
  if (isPaused) return;
  isPaused = true;
  const now = Date.now();
  for (const timer of timers.values()) {
    if (timer.handle === null) continue;
    clearTimeout(timer.handle);
    timer.handle = null;
    timer.remaining = Math.max(0, timer.remaining - (now - timer.startedAt));
  }
}

export function resumeToasts(): void {
  if (!isPaused) return;
  isPaused = false;
  for (const [id, timer] of timers) {
    timer.remaining = Math.max(timer.remaining, RESUME_MS);
    runTimer(id, timer);
  }
}
