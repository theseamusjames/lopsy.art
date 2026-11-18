/**
 * The Edit view's Areas state: whether the panel is open, which area is
 * selected (its mask shows in red), and the overlay the selected area's
 * handles are drawn on. Kept out of EditView so the view only wires it.
 */

import { useCallback, useEffect, useState } from 'react';
import { addArea, liveAreas, type Area, type AreaKind, type Recipe } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import { newId } from '@lopsy/photos-core/library/ids';
import type { DevelopEngine } from '../../engine/develop-engine';
import type { AreaFrame } from '../../engine/areas';

type Box = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

export interface UseAreasOptions {
  readonly engine: DevelopEngine | null;
  /** The recipe shown, a drag in progress included. */
  readonly recipe: Recipe;
  /** The recipe as saved, to add areas to. */
  readonly savedRecipe: Recipe;
  /** False while the photo cannot be edited (loading, Before, cropping). */
  readonly isActive: boolean;
  /** Where the document is on the stage. */
  readonly box: Box | null;
  readonly documentSize: { readonly width: number; readonly height: number } | null;
  readonly commit: (changes: Readonly<Record<string, Json>>, label: string) => void;
  readonly title: (area: Area, index: number) => string;
}

export interface AreasState {
  readonly isOpen: boolean;
  readonly selectedId: string | null;
  toggle(): void;
  select(id: string | null): void;
  add(kind: AreaKind): void;
  /** The selected area's handles, when there are any to show. */
  readonly overlay: {
    readonly area: Area;
    readonly frame: AreaFrame;
    readonly box: Box;
    readonly documentSize: { readonly width: number; readonly height: number };
  } | null;
}

export function useAreas({ engine, recipe, savedRecipe, isActive, box, documentSize, commit }: UseAreasOptions): AreasState {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const areas = liveAreas(recipe);
  const index = areas.findIndex((a) => a.id === selectedId);
  const selected = index >= 0 ? areas[index] ?? null : null;
  const shownIndex = isOpen && isActive && selected ? index : -1;

  // The selected area's mask, in red on screen only.
  useEffect(() => {
    engine?.setAreaOverlay(shownIndex);
  }, [engine, shownIndex]);

  // An area that was undone away, or deleted elsewhere, is no longer selected.
  useEffect(() => {
    if (selectedId !== null && !areas.some((a) => a.id === selectedId)) setSelectedId(null);
  }, [areas, selectedId]);

  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  const add = useCallback(
    (kind: AreaKind) => {
      const created = addArea(savedRecipe, kind, newId());
      if (!created) return;
      commit(created.values, kind === 'linear' ? 'Add linear area' : 'Add radial area');
      setSelectedId(created.id);
    },
    [savedRecipe, commit],
  );

  const frame = engine?.areaFrame() ?? null;
  const overlay =
    isOpen && isActive && selected && frame && box && documentSize ? { area: selected, frame, box, documentSize } : null;

  return { isOpen, selectedId, toggle, select: setSelectedId, add, overlay };
}
