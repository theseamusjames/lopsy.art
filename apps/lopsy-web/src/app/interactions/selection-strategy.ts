import type { InteractionState, InteractionContext } from './interaction-types';
import type { Point } from '../../types';

export type SelectionToolId = 'marquee-rect' | 'marquee-ellipse' | 'wand' | 'lasso' | 'lasso-magnetic';

export interface SelectionUpContext {
  screenToCanvas: (sx: number, sy: number) => Point;
  containerRef: React.RefObject<HTMLDivElement | null>;
  event: { clientX: number; clientY: number };
}

export interface SelectionToolStrategy {
  onDown(ctx: InteractionContext, tool: SelectionToolId): InteractionState | undefined;
  onMove?(state: InteractionState, canvasPos: Point, metaKey: boolean): void;
  onUp?(state: InteractionState, canvasPos: Point, upCtx: SelectionUpContext): void;
}
