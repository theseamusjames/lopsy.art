/**
 * The document that came from Photonamous, if any, and the state of its
 * last Save to Photonamous. Null for everyone who never uses Photos, so
 * the bar never shows for them.
 */

import { create } from 'zustand';
import type { PhotosConnection } from '@lopsy/handoff/lopsy';
import type { CameraSummary } from '@lopsy/handoff/messages';

export type PhotosSaveStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved' }
  | { readonly kind: 'failed'; readonly reason: string };

export interface PhotosHandoffSession {
  /** The name Photos gave the document. */
  readonly name: string;
  /** The editor document it opened as. Opening or creating another document ends the bar. */
  readonly documentId: string;
  readonly connection: PhotosConnection;
  /** The photo's camera metadata summary, kept in the `.lopsy` with the source block. */
  readonly camera?: CameraSummary;
}

interface PhotosHandoffState {
  session: PhotosHandoffSession | null;
  status: PhotosSaveStatus;
  start: (session: PhotosHandoffSession) => void;
  setStatus: (status: PhotosSaveStatus) => void;
  end: () => void;
}

/** The session, while the editor still shows the document it opened. */
export function activePhotosSession(session: PhotosHandoffSession | null, documentId: string): PhotosHandoffSession | null {
  return session && session.documentId === documentId ? session : null;
}

export const usePhotosHandoffStore = create<PhotosHandoffState>((set) => ({
  session: null,
  status: { kind: 'idle' },
  start: (session) => set({ session, status: { kind: 'idle' } }),
  setStatus: (status) => set({ status }),
  end: () => set({ session: null, status: { kind: 'idle' } }),
}));
