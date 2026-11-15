import type { Layer, TextLayer } from '../../../types';

export interface UnbindPathTextResult {
  readonly layers: Layer[];
  /** Text layers that lost their binding; their `x`/`y` now hold the text anchor. */
  readonly unboundIds: string[];
}

/**
 * Unbind every text layer that follows `pathId`, as choosing Path → None
 * does: the binding fields are cleared and `x`/`y` go back to the pre-bind
 * anchor. Returns null when no layer is bound to the path.
 */
export function computeUnbindPathText(
  layers: readonly Layer[],
  pathId: string,
): UnbindPathTextResult | null {
  const unboundIds: string[] = [];
  const next = layers.map((l) => {
    if (l.type !== 'text' || l.pathId !== pathId) return l;
    unboundIds.push(l.id);
    const unbound: TextLayer = {
      ...l,
      x: l.prePathX ?? l.x,
      y: l.prePathY ?? l.y,
      pathId: undefined,
      prePathX: undefined,
      prePathY: undefined,
      pathAnchorX: undefined,
      pathAnchorY: undefined,
    };
    return unbound;
  });
  if (unboundIds.length === 0) return null;
  return { layers: next, unboundIds };
}
