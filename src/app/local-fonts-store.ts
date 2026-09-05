import { create } from 'zustand';
import { fontsByFamily, type FontEntry } from '../utils/font-catalog';
import { groupLocalFontFaces, type LocalFontFace } from '../utils/local-fonts';
import { getEngine } from '../engine-wasm/engine-state';
import { isFontLoaded, loadFontData } from '../engine-wasm/wasm-bridge';
import { describeError } from './notifications-store';

/** A face record from `queryLocalFonts()`; `blob()` yields the raw SFNT bytes. */
export interface LocalFontData extends LocalFontFace {
  blob(): Promise<Blob>;
}

declare global {
  interface Window {
    /** Local Font Access API — Chromium desktop only, secure contexts only. */
    queryLocalFonts?: (options?: { postscriptNames?: readonly string[] }) => Promise<LocalFontData[]>;
  }
}

export type LocalFontsStatus = 'idle' | 'unsupported' | 'loading' | 'ready' | 'failed';

interface LocalFontsState {
  readonly status: LocalFontsStatus;
  /** One catalog-shaped entry per installed family, alphabetical. */
  readonly entries: readonly FontEntry[];
  readonly byFamily: ReadonlyMap<string, FontEntry>;
  readonly error: string | null;
  /**
   * Enumerate the fonts installed on this machine. Idempotent while a query is
   * in flight; safe to call again after a failure (re-prompts for permission).
   */
  loadLocalFonts: () => Promise<void>;
}

// The live FontData handles, kept outside the store: they are opaque browser
// objects whose only job is to hand over bytes on demand.
const facesByFamily = new Map<string, LocalFontData[]>();
const inflightEngineLoads = new Map<string, Promise<boolean>>();

export const useLocalFontsStore = create<LocalFontsState>((set, get) => ({
  status: 'idle',
  entries: [],
  byFamily: new Map(),
  error: null,

  loadLocalFonts: async () => {
    if (typeof window === 'undefined' || typeof window.queryLocalFonts !== 'function') {
      set({ status: 'unsupported' });
      return;
    }
    if (get().status === 'loading') return;
    set({ status: 'loading', error: null });
    try {
      const faces = await window.queryLocalFonts();
      facesByFamily.clear();
      for (const face of faces) {
        const family = face.family.trim();
        const list = facesByFamily.get(family);
        if (list) list.push(face);
        else facesByFamily.set(family, [face]);
      }
      const entries = groupLocalFontFaces(faces);
      set({ status: 'ready', entries, byFamily: new Map(entries.map((e) => [e.family, e])) });
    } catch (err) {
      set({ status: 'failed', error: describeError(err) });
      // Chrome rejects the query while the tab is hidden ("Page needs to be
      // visible") — the editor opened in a background tab, say. Try again
      // once the user is actually looking at it.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        document.addEventListener('visibilitychange', () => void get().loadLocalFonts(), { once: true });
      }
    }
  },
}));

/** Catalog lookup that prefers a locally installed family over the static catalog. */
export function findFontEntry(family: string): FontEntry | undefined {
  return useLocalFontsStore.getState().byFamily.get(family) ?? fontsByFamily.get(family);
}

/** Reactive {@link findFontEntry}: re-renders once local fonts finish loading. */
export function useFontEntry(family: string): FontEntry | undefined {
  const byFamily = useLocalFontsStore((s) => s.byFamily);
  return byFamily.get(family) ?? fontsByFamily.get(family);
}

async function readFaceBytes(face: LocalFontData): Promise<Uint8Array | null> {
  try {
    const blob = await face.blob();
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Push every face of a local family into the engine's font database so the
 * canvas renders the real face instead of the bundled Inter fallback. Loading
 * all faces (not just the picked weight) lets the engine's own weight/style
 * matching work, so a later weight change needs no further I/O.
 *
 * Resolves `true` when the family was freshly loaded (callers re-render text
 * that uses it), `false` when it was already in the engine, is not a local
 * family, or could not be parsed.
 */
export function loadLocalFontToEngine(family: string): Promise<boolean> {
  const faces = facesByFamily.get(family);
  if (!faces || faces.length === 0) return Promise.resolve(false);
  const engine = getEngine();
  if (!engine || isFontLoaded(engine, family)) return Promise.resolve(false);

  const inflight = inflightEngineLoads.get(family);
  if (inflight) return inflight;

  const load = (async () => {
    const buffers = await Promise.all(faces.map(readFaceBytes));
    // The engine may have been torn down and recreated (File > New) while the
    // blobs were being read; load into whichever engine is current.
    const current = getEngine();
    if (!current) return false;
    for (const bytes of buffers) {
      if (bytes) loadFontData(current, bytes);
    }
    return isFontLoaded(current, family);
  })().finally(() => inflightEngineLoads.delete(family));

  inflightEngineLoads.set(family, load);
  return load;
}
