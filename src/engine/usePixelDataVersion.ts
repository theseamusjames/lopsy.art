import { useSyncExternalStore } from 'react';
import { pixelDataManager } from './pixel-data-manager';

/**
 * Subscribes to the version counter of a single layer's pixel data.
 * Returns an opaque integer that changes every time that layer's pixel
 * data mutates — use it as a useEffect dependency to re-run whenever
 * the underlying pixels change.
 */
export function usePixelDataVersion(layerId: string): number {
  return useSyncExternalStore(
    pixelDataManager.subscribe.bind(pixelDataManager),
    () => pixelDataManager.versionOf(layerId),
  );
}
