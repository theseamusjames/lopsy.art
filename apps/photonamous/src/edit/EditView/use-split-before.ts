import { useEffect, useRef, useState } from 'react';
import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { DevelopEngine } from '../../engine/develop-engine';
import { beforeRecipe } from '../edit-controls';

/** How long the split's size and framing must rest before the before side is rendered again. */
const RENDER_DELAY_MS = 200;
const MAX_LONG_EDGE = 2048;

/**
 * The split view's before side: the photo with the default develop
 * settings in the edit's framing, rendered at `longEdge` (the size it is
 * shown at) as an object URL. It depends only on the framing and the size,
 * so develop edits do not render it again. Null while it renders or when
 * `longEdge` is 0 (no split).
 */
export function useSplitBefore(
  engine: DevelopEngine | null,
  savedRecipe: Recipe,
  longEdge: number,
  renderKey: string,
): string | null {
  const [src, setSrc] = useState<string | null>(null);
  const inputs = useRef({ savedRecipe, longEdge });
  inputs.current = { savedRecipe, longEdge };
  const maxSize = Math.min(MAX_LONG_EDGE, Math.max(64, Math.round(longEdge)));
  const key = longEdge > 0 ? `${JSON.stringify(savedRecipe.framing)}@${Math.round(maxSize / 64)}:${renderKey}` : null;

  useEffect(() => {
    if (!engine || !key) return;
    let isCancelled = false;
    let url: string | null = null;
    const timer = setTimeout(() => {
      const now = inputs.current;
      engine
        .exportImage({
          format: 'jpeg',
          quality: 0.9,
          maxSize: Math.min(MAX_LONG_EDGE, Math.max(64, Math.round(now.longEdge))),
          recipe: beforeRecipe(now.savedRecipe),
        })
        .then((blob) => {
          if (isCancelled) return;
          url = URL.createObjectURL(blob);
          setSrc(url);
        })
        .catch((err: unknown) => console.warn('Lopsy Photos: the before view could not be rendered', err));
    }, RENDER_DELAY_MS);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [engine, key]);

  return src;
}
