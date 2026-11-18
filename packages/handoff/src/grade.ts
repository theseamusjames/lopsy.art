/**
 * Grade a layer (spec 6.12, L5): Lopsy sends one raster layer to Photos'
 * Edit view and gets it back graded. Lopsy opens Photos at `?grade=<id>`;
 * the Photos page says ready, receives the layer, and answers once with the
 * graded pixels and recipe (Done) or with nothing (Cancel).
 */

import {
  browserWindow,
  createHandoffId,
  HandoffError,
  listen,
  resolveAppUrl,
  waitForMessage,
  withParam,
  type HandoffPeer,
  type HandoffWindow,
} from './channel.ts';
import {
  GRADE_PARAM,
  GRADE_WINDOW_NAME,
  PROTOCOL_VERSION,
  isHandoffId,
  parseLopsyGrade,
  parsePhotosGraded,
  parsePhotosReady,
  type GradeLayer,
  type GradeRecipe,
  type LopsyGradeMessage,
  type PhotosGradedMessage,
  type PhotosReadyMessage,
} from './messages.ts';

// ---- Lopsy's side ------------------------------------------------------

export type GradeResult =
  | { readonly kind: 'graded'; readonly png: ArrayBuffer; readonly recipe: GradeRecipe }
  | { readonly kind: 'cancelled' };

export interface GradeInPhotosOptions {
  /** Photos' URL (`VITE_PHOTOS_URL`). Its origin is the only one trusted. */
  readonly photosUrl: string;
  /**
   * The layer, or a promise of it: Photos is opened at once, inside the
   * click that allows the popup. Its pixels are transferred.
   */
  readonly layer: GradeLayer | Promise<GradeLayer>;
  readonly timeouts?: {
    /** For Photos to load and say ready. Default 60 s. */
    readonly readyMs?: number;
    /** For the user to finish grading. Default 24 h. */
    readonly gradeMs?: number;
  };
  readonly window?: HandoffWindow;
}

/**
 * Opens Photos to grade a layer and resolves with the graded pixels and
 * recipe, or `cancelled` when the user pressed Cancel or closed the tab.
 * Rejects when Photos cannot be opened or does not load.
 */
export async function gradeInPhotos(options: GradeInPhotosOptions): Promise<GradeResult> {
  const win = options.window ?? browserWindow();
  const photosUrl = resolveAppUrl(options.photosUrl, win);
  const origin = photosUrl.origin;
  const id = createHandoffId();
  const opened = win.open(withParam(photosUrl, GRADE_PARAM, id), GRADE_WINDOW_NAME);
  if (!opened) throw new HandoffError('popup-blocked', 'The browser blocked opening Lopsy Photos.');
  const peer = opened;
  const layerPromise = Promise.resolve(options.layer);
  layerPromise.catch(() => {});

  const ready = waitForMessage(win, {
    origin,
    source: () => peer,
    parse: (data) => {
      const m = parsePhotosReady(data);
      return m && m.id === id ? m : null;
    },
    timeoutMs: options.timeouts?.readyMs ?? 60_000,
    timeoutMessage: 'Lopsy Photos did not open in time.',
    isClosed: () => peer.closed,
  });
  ready.catch(() => {});
  const layer = await layerPromise;
  await ready;

  const graded = waitForMessage(win, {
    origin,
    source: () => peer,
    parse: (data) => {
      const m = parsePhotosGraded(data);
      return m && m.id === id ? m : null;
    },
    timeoutMs: options.timeouts?.gradeMs ?? 24 * 60 * 60 * 1000,
    timeoutMessage: 'Lopsy Photos did not finish the grade.',
    isClosed: () => peer.closed,
  });
  const message: LopsyGradeMessage = { protocol: PROTOCOL_VERSION, type: 'lopsy:grade', id, layer };
  peer.postMessage(message, origin, [layer.pixels]);

  let answer: PhotosGradedMessage;
  try {
    ({ message: answer } = await graded);
  } catch (err) {
    // Closing the Photos tab is a cancel, not a failure.
    if (err instanceof HandoffError && err.code === 'closed') return { kind: 'cancelled' };
    throw err;
  }
  if (answer.ok) return { kind: 'graded', png: answer.png, recipe: answer.recipe };
  if (answer.cancelled) return { kind: 'cancelled' };
  throw new Error(answer.error ?? 'Lopsy Photos could not grade the layer.');
}

// ---- Photos' side ------------------------------------------------------

/** The `?grade=<id>` value of a Photos page Lopsy opened to grade a layer, or null. */
export function readGradeId(search: string): string | null {
  const value = new URLSearchParams(search).get(GRADE_PARAM);
  return isHandoffId(value) ? value : null;
}

export interface GradeSession {
  readonly id: string;
  /** The layer to grade, once Lopsy sends it. Rejects when Lopsy does not. */
  readonly layer: Promise<GradeLayer>;
  /** Done: sends the graded 16-bit PNG and the recipe. The PNG is transferred. */
  done(png: ArrayBuffer, recipe: GradeRecipe): void;
  /** Cancel: tells Lopsy to keep the layer as it was. */
  cancel(): void;
  /** Reports a failure (for example a render that failed) instead of a result. */
  fail(error: string): void;
}

export interface ReceiveGradeOptions {
  /** Lopsy's URL (`VITE_LOPSY_URL`). */
  readonly lopsyUrl: string;
  /** From `readGradeId`. */
  readonly id: string;
  /** For Lopsy to send the layer after Photos says ready. Default 60 s. */
  readonly timeoutMs?: number;
  readonly window?: HandoffWindow;
}

/** For a Photos page Lopsy opened with `?grade=<id>`: says ready and receives the layer. */
export function receiveGrade(options: ReceiveGradeOptions): GradeSession {
  const win = options.window ?? browserWindow();
  const origin = resolveAppUrl(options.lopsyUrl, win).origin;
  const { id } = options;
  const opener: HandoffPeer | null = win.opener;

  let isAnswered = false;
  const answer = (message: PhotosGradedMessage, transfer: Transferable[] = []): void => {
    if (isAnswered || !opener || opener.closed) return;
    isAnswered = true;
    opener.postMessage(message, origin, transfer);
  };

  const layer = new Promise<GradeLayer>((resolve, reject) => {
    if (!opener || !isHandoffId(id)) {
      reject(new HandoffError('no-opener', 'This page was not opened by Lopsy.'));
      return;
    }
    const timer = win.setTimeout(() => {
      stop();
      reject(new HandoffError('timeout', 'Lopsy did not send the layer in time.'));
    }, options.timeoutMs ?? 60_000);
    const stop = listen(win, origin, () => opener, (data) => {
      const m = parseLopsyGrade(data);
      if (!m || m.id !== id) return;
      stop();
      win.clearTimeout(timer);
      resolve(m.layer);
    });
    const ready: PhotosReadyMessage = { protocol: PROTOCOL_VERSION, type: 'photos:ready', id };
    opener.postMessage(ready, origin);
  });
  layer.catch(() => {});

  return {
    id,
    layer,
    done: (png, recipe) =>
      answer({ protocol: PROTOCOL_VERSION, type: 'photos:graded', id, ok: true, png, recipe }, [png]),
    cancel: () => answer({ protocol: PROTOCOL_VERSION, type: 'photos:graded', id, ok: false, cancelled: true }),
    fail: (error) => answer({ protocol: PROTOCOL_VERSION, type: 'photos:graded', id, ok: false, cancelled: false, error }),
  };
}
