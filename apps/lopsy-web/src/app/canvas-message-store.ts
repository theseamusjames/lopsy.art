/**
 * The message shown centred over the canvas (components/CanvasMessage):
 * one at a time, for something the person must not miss, such as an image
 * too large to open (app/report-open-failure.ts). A new message replaces
 * the one showing; a different document clears it, since the message was
 * about opening the one that did not open.
 */
import { create } from 'zustand';

export interface CanvasMessage {
  readonly title: string;
  readonly body: string;
  /** The editor's `documentVersion` when it was shown: once that changes, another document opened and the message is gone. */
  readonly documentVersion: number;
}

interface CanvasMessageState {
  readonly message: CanvasMessage | null;
  show: (message: CanvasMessage) => void;
  dismiss: () => void;
}

export const useCanvasMessageStore = create<CanvasMessageState>((set) => ({
  message: null,
  show: (message) => set({ message }),
  dismiss: () => set({ message: null }),
}));
