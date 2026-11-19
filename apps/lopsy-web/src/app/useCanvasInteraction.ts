import { useCallback, useEffect, useMemo } from 'react';
import {
  attachGestureSession,
  cancelHoldTimer,
  clearPersistentTransform,
  gestureDown,
  gestureMove,
  gestureUp,
  nudgeMove,
  nudgeSelection,
} from './interactions/gesture-session';
import type { GestureEnvironment, ToolEvent } from './interactions/gesture-session';

import type { Point } from '../types';

export function useCanvasInteraction(
  screenToCanvas: (screenX: number, screenY: number) => Point,
  containerRef: React.RefObject<HTMLDivElement | null>,
  screenToPixel?: (screenX: number, screenY: number) => Point,
) {
  // Clean up the hold timer on unmount
  useEffect(() => cancelHoldTimer, []);

  useEffect(() => attachGestureSession(), []);

  const env = useMemo<GestureEnvironment>(
    () => ({
      toCanvas: (clientX: number, clientY: number): Point | null => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        return screenToCanvas(clientX - rect.left, clientY - rect.top);
      },
      toPixel: (clientX: number, clientY: number): Point | undefined => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || !screenToPixel) return undefined;
        return screenToPixel(clientX - rect.left, clientY - rect.top);
      },
    }),
    [screenToCanvas, containerRef, screenToPixel],
  );

  const handleToolDown = useCallback((e: ToolEvent) => gestureDown(e, env), [env]);
  const handleToolMove = useCallback((e: ToolEvent) => gestureMove(e, env), [env]);
  const handleToolUp = useCallback((e: ToolEvent) => gestureUp(e, env), [env]);

  return { handleToolDown, handleToolMove, handleToolUp, clearPersistentTransform, nudgeMove, nudgeSelection };
}
