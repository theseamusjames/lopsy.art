import { useEffect } from 'react';
import { useUi } from '../../app/store';
import type { DevelopEngine } from '../../engine/develop-engine';
import type { View } from '../../engine/viewport';

/**
 * Tells the status bar the photo's size and the size it is edited at. Read
 * again whenever the view changes, which it does after a load, a crop and
 * the full resolution coming in; cleared when the Edit view goes.
 */
export function useEditSizes(engine: DevelopEngine | null, view: View | null, isReady: boolean): void {
  useEffect(() => {
    const working = isReady ? engine?.imageSize() ?? null : null;
    const photo = isReady ? engine?.fullResolutionSize() ?? null : null;
    const sizes = working && photo ? { photo, working } : null;
    const now = useUi.getState().editSizes;
    const isSame =
      now !== null && sizes !== null && now.photo.width === sizes.photo.width && now.photo.height === sizes.photo.height &&
      now.working.width === sizes.working.width && now.working.height === sizes.working.height;
    if (!isSame && (now !== null || sizes !== null)) useUi.getState().setEditSizes(sizes);
  }, [engine, view, isReady]);

  useEffect(() => () => useUi.getState().setEditSizes(null), []);
}
