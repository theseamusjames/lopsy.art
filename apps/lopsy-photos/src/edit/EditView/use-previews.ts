import { useCallback, useEffect, useRef } from 'react';
import { recipeHash, type Recipe } from '@lopsy/photos-core/library/recipe';
import type { Version } from '@lopsy/photos-core/library/types';
import type { DevelopEngine } from '../../engine/develop-engine';
import { isPreviewStale } from '../edit-keys';

/** How long the edit must stay unchanged before previews are rendered. */
const SETTLE_MS = 1200;
const THUMB_SIZE = 512;
const SCREEN_SIZE = 2048;

export interface RenderedPreviews {
  readonly thumb: Blob;
  readonly screen: Blob;
  readonly recipeHash: string;
}

async function renderPreviews(engine: DevelopEngine, recipe: Recipe): Promise<RenderedPreviews> {
  const thumb = await engine.renderPreview(THUMB_SIZE, undefined, recipe);
  const screen = await engine.renderPreview(SCREEN_SIZE, undefined, recipe);
  return { thumb, screen, recipeHash: recipeHash(recipe) };
}

/**
 * The version's 512 px and 2048 px previews, rendered once the edit has
 * rested (`isSettled`) and whenever `refreshPreviews` is called (on
 * leaving). A preview already at the edit is not rendered again; renders
 * run one after another.
 */
export function usePreviews(
  engine: DevelopEngine | null,
  version: Version,
  savedRecipe: Recipe,
  isSettled: boolean,
  onPreviewRendered: ((previews: RenderedPreviews) => void) | undefined,
): { refreshPreviews: (recipe: Recipe) => Promise<void> } {
  const previewed = useRef({ thumbHash: version.thumb?.recipeHash ?? null, screenHash: version.screen?.recipeHash ?? null });
  useEffect(() => {
    previewed.current = { thumbHash: version.thumb?.recipeHash ?? null, screenHash: version.screen?.recipeHash ?? null };
    // Only a switch to another version restarts what the previews are compared with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version.id]);
  const callbackRef = useRef(onPreviewRendered);
  callbackRef.current = onPreviewRendered;
  const job = useRef<Promise<void> | null>(null);

  const refreshPreviews = useCallback(
    (recipe: Recipe): Promise<void> => {
      const callback = callbackRef.current;
      const hash = recipeHash(recipe);
      if (!engine || !callback || !isPreviewStale(previewed.current, hash)) return Promise.resolve();
      const run = async () => {
        try {
          const previews = await renderPreviews(engine, recipe);
          previewed.current = { thumbHash: previews.recipeHash, screenHash: previews.recipeHash };
          callback(previews);
        } catch (err) {
          console.warn('Lopsy Photos: previews could not be rendered', err);
        }
      };
      const next = (job.current ?? Promise.resolve()).then(run);
      job.current = next;
      return next;
    },
    [engine],
  );

  useEffect(() => {
    if (!isSettled) return;
    const timer = setTimeout(() => void refreshPreviews(savedRecipe), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [isSettled, savedRecipe, refreshPreviews]);

  return { refreshPreviews };
}
