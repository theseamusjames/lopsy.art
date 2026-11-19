/**
 * Alt (Option) while dragging a slider shows what it affects (spec 5.4):
 * Sharpen's amount, radius and edges show the sharpening mask, Blacks the
 * shadow clipping and Whites the highlight clipping, for as long as the
 * drag lasts and the key is held.
 */

import { useEffect, useState } from 'react';
import type { Json } from '@lopsy/photos-core/library/types';
import type { DevelopEngine } from '../engine/develop-engine';
import { useClippingWarning } from './clipping-warning';

const SHARPEN_PATHS = ['sharpness.amount', 'sharpness.radius', 'sharpness.edges'];

export interface AltDragView {
  readonly sharpenMask: boolean;
  readonly shadows: boolean;
  readonly highlights: boolean;
}

/** What to show for the paths being dragged (the Edit view's draft) with Alt held or not. */
export function altDragView(draggedPaths: readonly string[], isAltDown: boolean): AltDragView {
  if (!isAltDown) return { sharpenMask: false, shadows: false, highlights: false };
  return {
    sharpenMask: draggedPaths.some((path) => SHARPEN_PATHS.includes(path)),
    shadows: draggedPaths.includes('tone.blacks'),
    highlights: draggedPaths.includes('tone.whites'),
  };
}

function useAltKey(): boolean {
  const [isDown, setIsDown] = useState(false);
  useEffect(() => {
    const track = (event: KeyboardEvent | PointerEvent) => setIsDown(event.altKey);
    const up = () => setIsDown(false);
    window.addEventListener('keydown', track);
    window.addEventListener('keyup', track);
    window.addEventListener('pointerdown', track, true);
    window.addEventListener('pointermove', track, true);
    window.addEventListener('blur', up);
    return () => {
      window.removeEventListener('keydown', track);
      window.removeEventListener('keyup', track);
      window.removeEventListener('pointerdown', track, true);
      window.removeEventListener('pointermove', track, true);
      window.removeEventListener('blur', up);
    };
  }, []);
  return isDown;
}

/** `draft` is the Edit view's in-progress slider change (null when nothing is being dragged). */
export function useAltDragViews(engine: DevelopEngine | null, draft: Readonly<Record<string, Json>> | null): void {
  const isAltDown = useAltKey();
  const view = altDragView(draft ? Object.keys(draft) : [], isAltDown);

  useEffect(() => {
    if (!engine) return;
    engine.setDetailMaskView(view.sharpenMask);
    return () => engine.setDetailMaskView(false);
  }, [engine, view.sharpenMask]);

  useEffect(() => {
    useClippingWarning.getState().setDuring({ shadows: view.shadows, highlights: view.highlights });
  }, [view.shadows, view.highlights]);
}
