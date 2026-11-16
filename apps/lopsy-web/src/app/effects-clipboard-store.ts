import { create } from 'zustand';
import type { EffectsClipboard } from './effects-clipboard';

interface EffectsClipboardState {
  readonly clipboard: EffectsClipboard | null;
  setClipboard: (clipboard: EffectsClipboard) => void;
}

/** In-app clipboard for the effects drawer's Copy / Paste buttons. */
export const useEffectsClipboardStore = create<EffectsClipboardState>((set) => ({
  clipboard: null,
  setClipboard: (clipboard) => set({ clipboard }),
}));
