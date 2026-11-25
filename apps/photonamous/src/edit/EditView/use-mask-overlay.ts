import { useCallback, useEffect, useRef, useState } from 'react';
import type { Json } from '@lopsy/photos-core/library/types';
import type { DevelopEngine } from '../../engine/develop-engine';
import { MASK_FLASH_MS, maskOverlayId } from '../mask-overlay';

export interface MaskFlash {
  /** Shows the selected mask for MASK_FLASH_MS from now: after a change to its shape. */
  readonly flash: () => void;
  /** Ends that moment now: an adjustment of the mask starts, or Show mask changes. */
  readonly endFlash: () => void;
}

/**
 * Shows the selected mask in red on the photo when `maskOverlayId` says
 * so (mask-overlay.ts), and for a moment whenever another mask is chosen or
 * added, or the Masks panel opens on one. `selectedId` is the selected
 * mask while the panel is open, else null; `draft` is the drag in
 * progress. The moment's timer stops when the Edit view closes.
 */
export function useMaskOverlay(
  engine: DevelopEngine | null,
  selectedId: string | null,
  isShown: boolean,
  draft: Readonly<Record<string, Json>> | null,
): MaskFlash {
  const [isFlashing, setIsFlashing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endFlash = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setIsFlashing(false);
  }, []);

  const flash = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    setIsFlashing(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setIsFlashing(false);
    }, MASK_FLASH_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  useEffect(() => {
    if (selectedId !== null) flash();
  }, [selectedId, flash]);

  const overlayId = maskOverlayId({ selectedId, isShown, isFlashing, draft });
  useEffect(() => {
    engine?.setAreaOverlay(overlayId);
  }, [engine, overlayId]);

  return { flash, endFlash };
}
