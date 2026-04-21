import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useEditorStore } from '../editor-store';
import { useUIStore } from '../ui-store';
import { isPanning, POINTER_IDLE, type PointerMode } from '../pointer-mode';
import { RULER_SIZE } from '../rendering/ruler-constants';

interface Point {
  x: number;
  y: number;
}

interface PointerHandlerDeps {
  containerRef: RefObject<HTMLDivElement | null>;
  screenToCanvas: (screenX: number, screenY: number) => Point;
  pointerMode: PointerMode;
  setPointerMode: (next: PointerMode | ((prev: PointerMode) => PointerMode)) => void;
  handleToolDown: (e: React.PointerEvent) => void;
  handleToolMove: (e: React.PointerEvent) => void;
  handleToolUp: (e: React.PointerEvent) => void;
  updateHoveredHandle: (pos: Point) => void;
}

export interface CanvasPointerHandlers {}

interface PointerState {
  id: number;
  clientX: number;
  clientY: number;
  type: 'mouse' | 'pen' | 'touch';
}

interface GestureState {
  active: boolean;
  startZoom: number;
  startPanX: number;
  startPanY: number;
  startDist: number;
  startMidX: number;
  startMidY: number;
}

function midpointOfTouches(pointers: Map<number, PointerState>): { midX: number; midY: number; dist: number } | null {
  const touches: PointerState[] = [];
  for (const p of pointers.values()) {
    if (p.type === 'touch') touches.push(p);
    if (touches.length === 2) break;
  }
  if (touches.length < 2) return null;
  const a = touches[0]!;
  const b = touches[1]!;
  return {
    midX: (a.clientX + b.clientX) / 2,
    midY: (a.clientY + b.clientY) / 2,
    dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
  };
}

function countTouchPointers(pointers: Map<number, PointerState>): number {
  let n = 0;
  for (const p of pointers.values()) if (p.type === 'touch') n++;
  return n;
}

function isInsideRect(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function useCanvasPointerHandlers({
  containerRef,
  screenToCanvas,
  pointerMode,
  setPointerMode,
  handleToolDown,
  handleToolMove,
  handleToolUp,
  updateHoveredHandle,
}: PointerHandlerDeps): CanvasPointerHandlers {
  const viewport = useEditorStore((s) => s.viewport);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);

  const showRulers = useUIStore((s) => s.showRulers);
  const showGuides = useUIStore((s) => s.showGuides);
  const guides = useUIStore((s) => s.guides);
  const addGuide = useUIStore((s) => s.addGuide);
  const setHoveredGuide = useUIStore((s) => s.setHoveredGuide);
  const setRulerHover = useUIStore((s) => s.setRulerHover);
  const openModal = useUIStore((s) => s.openModal);
  const closeModal = useUIStore((s) => s.closeModal);
  const closeModalOfKind = useUIStore((s) => s.closeModalOfKind);

  const pointersRef = useRef<Map<number, PointerState>>(new Map());
  const gestureRef = useRef<GestureState>({
    active: false,
    startZoom: 1,
    startPanX: 0,
    startPanY: 0,
    startDist: 0,
    startMidX: 0,
    startMidY: 0,
  });
  const toolPointerIdRef = useRef<number | null>(null);

  // Latest-ref pattern: handlers attached to window close over the first
  // render's deps. We keep a ref that the render phase always writes to and
  // the listeners read from, so the listeners always see current state.
  const depsRef = useRef({
    containerRef, screenToCanvas, pointerMode, setPointerMode,
    handleToolDown, handleToolMove, handleToolUp, updateHoveredHandle,
    viewport, setZoom, setPan,
    showRulers, showGuides, guides,
    addGuide, setHoveredGuide, setRulerHover,
    openModal, closeModal, closeModalOfKind,
  });
  depsRef.current = {
    containerRef, screenToCanvas, pointerMode, setPointerMode,
    handleToolDown, handleToolMove, handleToolUp, updateHoveredHandle,
    viewport, setZoom, setPan,
    showRulers, showGuides, guides,
    addGuide, setHoveredGuide, setRulerHover,
    openModal, closeModal, closeModalOfKind,
  };

  const pendingCursorRef = useRef<Point | null>(null);
  const cursorRafRef = useRef(0);
  const flushCursorPosition = useCallback((pos: Point) => {
    pendingCursorRef.current = pos;
    if (cursorRafRef.current) return;
    cursorRafRef.current = requestAnimationFrame(() => {
      cursorRafRef.current = 0;
      if (pendingCursorRef.current) {
        useUIStore.getState().setCursorPosition(pendingCursorRef.current);
        pendingCursorRef.current = null;
      }
    });
  }, []);

  useEffect(() => {
    function findGuideAtCursor(docX: number, docY: number): string | null {
      for (const guide of depsRef.current.guides) {
        if (guide.orientation === 'vertical' && Math.abs(guide.position - docX) <= 1) return guide.id;
        if (guide.orientation === 'horizontal' && Math.abs(guide.position - docY) <= 1) return guide.id;
      }
      return null;
    }

    function startGesture(viewport: typeof depsRef.current.viewport): void {
      const mid = midpointOfTouches(pointersRef.current);
      if (!mid) return;
      gestureRef.current = {
        active: true,
        startZoom: viewport.zoom,
        startPanX: viewport.panX,
        startPanY: viewport.panY,
        startDist: mid.dist,
        startMidX: mid.midX,
        startMidY: mid.midY,
      };
    }

    const handlePointerDown = (e: PointerEvent): void => {
      const deps = depsRef.current;
      pointersRef.current.set(e.pointerId, {
        id: e.pointerId,
        clientX: e.clientX,
        clientY: e.clientY,
        type: e.pointerType as PointerState['type'],
      });

      // Two-finger touch anywhere in the viewport = pinch/pan gesture.
      // This catches touches starting outside the canvas as well (e.g.,
      // on UI chrome) so the gesture doesn't require both fingers to land
      // precisely on the canvas.
      if (e.pointerType === 'touch' && countTouchPointers(pointersRef.current) === 2) {
        const toolId = toolPointerIdRef.current;
        if (toolId !== null) {
          const toolPointer = pointersRef.current.get(toolId);
          const toolUpEvent = toolPointer
            ? { ...e, clientX: toolPointer.clientX, clientY: toolPointer.clientY, pointerId: toolId } as unknown as React.PointerEvent
            : e as unknown as React.PointerEvent;
          deps.handleToolUp(toolUpEvent);
          toolPointerIdRef.current = null;
        }
        startGesture(deps.viewport);
        return;
      }

      if (gestureRef.current.active) return;

      const container = deps.containerRef.current;
      const rect = container?.getBoundingClientRect();
      if (!rect || !container) return;
      // Tool/pan interactions originate from inside the canvas container.
      // DOM ancestry check (not just rect) so pointer events on sibling
      // overlays that visually sit above the canvas — e.g. the effects
      // drawer, positioned right:100% over the canvas area — don't start
      // a tool stroke.
      const target = e.target as Node | null;
      if (!target || !container.contains(target)) return;

      // Space-held + primary, or middle-click, starts a pan.
      if (deps.pointerMode.kind === 'spaceHeld' || e.button === 1) {
        deps.setPointerMode({
          kind: 'panning',
          startScreenX: e.clientX,
          startScreenY: e.clientY,
          startPanX: deps.viewport.panX,
          startPanY: deps.viewport.panY,
        });
        e.preventDefault();
        return;
      }

      if (deps.showRulers && e.button === 0) {
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;

        if (deps.showGuides && screenX < RULER_SIZE && screenY < RULER_SIZE) {
          const modalNow = useUIStore.getState().modal;
          if (modalNow?.kind === 'guideColor') deps.closeModal();
          else deps.openModal({ kind: 'guideColor' });
          return;
        }
      }

      if (useUIStore.getState().modal?.kind === 'guideColor') {
        deps.closeModalOfKind('guideColor');
      }

      if (deps.showRulers && deps.showGuides && e.button === 0) {
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const isOnHorizontalRuler = screenY < RULER_SIZE && screenX > RULER_SIZE;
        const isOnVerticalRuler = screenX < RULER_SIZE && screenY > RULER_SIZE;

        const canvasPos = deps.screenToCanvas(screenX, screenY);

        if (isOnHorizontalRuler || isOnVerticalRuler) {
          const guideId = findGuideAtCursor(canvasPos.x, canvasPos.y);
          if (guideId) {
            useUIStore.getState().removeGuide(guideId);
          } else if (isOnHorizontalRuler) {
            deps.addGuide('vertical', canvasPos.x);
          } else {
            deps.addGuide('horizontal', canvasPos.y);
          }
          deps.setRulerHover(null);
          return;
        }
      }

      if (e.button === 0) {
        toolPointerIdRef.current = e.pointerId;
        deps.handleToolDown(e as unknown as React.PointerEvent);
      }
    };

    const handlePointerMove = (e: PointerEvent): void => {
      const deps = depsRef.current;
      const existing = pointersRef.current.get(e.pointerId);
      if (existing) {
        existing.clientX = e.clientX;
        existing.clientY = e.clientY;
      }

      if (gestureRef.current.active) {
        const mid = midpointOfTouches(pointersRef.current);
        if (!mid || gestureRef.current.startDist <= 0) return;
        const scale = mid.dist / gestureRef.current.startDist;
        const newZoom = Math.max(0.01, Math.min(64, gestureRef.current.startZoom * scale));
        deps.setZoom(newZoom);
        const dx = mid.midX - gestureRef.current.startMidX;
        const dy = mid.midY - gestureRef.current.startMidY;
        deps.setPan(gestureRef.current.startPanX + dx, gestureRef.current.startPanY + dy);
        return;
      }

      const rect = deps.containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const inside = isInsideRect(rect, e.clientX, e.clientY);
      const isToolPointer = toolPointerIdRef.current === e.pointerId;
      const isPan = deps.pointerMode.kind === 'panning';

      // Outside canvas and not driving any active interaction — ignore.
      if (!inside && !isToolPointer && !isPan) return;

      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const canvasPos = deps.screenToCanvas(screenX, screenY);
      flushCursorPosition(canvasPos);

      const panning = isPanning(deps.pointerMode);

      if (deps.showGuides && !panning && inside) {
        deps.setHoveredGuide(findGuideAtCursor(canvasPos.x, canvasPos.y));
      }

      if (deps.showRulers && deps.showGuides && !panning && inside) {
        const isOnHorizontalRuler = screenY < RULER_SIZE && screenX > RULER_SIZE;
        const isOnVerticalRuler = screenX < RULER_SIZE && screenY > RULER_SIZE;

        if (isOnHorizontalRuler) {
          deps.setRulerHover({ orientation: 'vertical', position: canvasPos.x, screenX, screenY });
          return;
        } else if (isOnVerticalRuler) {
          deps.setRulerHover({ orientation: 'horizontal', position: canvasPos.y, screenX, screenY });
          return;
        } else {
          deps.setRulerHover(null);
        }
      }

      if (deps.pointerMode.kind === 'panning') {
        const dx = e.clientX - deps.pointerMode.startScreenX;
        const dy = e.clientY - deps.pointerMode.startScreenY;
        deps.setPan(deps.pointerMode.startPanX + dx, deps.pointerMode.startPanY + dy);
      } else if (isToolPointer) {
        deps.updateHoveredHandle(canvasPos);
        // Feed every hardware sample to the tool. Browsers cap pointermove
        // delivery at display refresh (~60 Hz) but stylus/high-polling-rate
        // input reports at 120–240 Hz; the intermediate samples live on
        // event.getCoalescedEvents(). Without them, brush interpolation
        // connects coarse positions with straight lines, producing the
        // visible polygonal segments on fast strokes.
        const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        if (coalesced.length > 1) {
          for (const ce of coalesced) {
            deps.handleToolMove(ce as unknown as React.PointerEvent);
          }
        } else {
          deps.handleToolMove(e as unknown as React.PointerEvent);
        }
      } else if (toolPointerIdRef.current === null && inside) {
        deps.updateHoveredHandle(canvasPos);
      }
    };

    const finishPointer = (e: PointerEvent): void => {
      const deps = depsRef.current;
      const wasToolPointer = toolPointerIdRef.current === e.pointerId;
      pointersRef.current.delete(e.pointerId);

      if (gestureRef.current.active) {
        if (countTouchPointers(pointersRef.current) < 2) {
          gestureRef.current.active = false;
        }
        return;
      }

      if (deps.pointerMode.kind === 'panning') {
        deps.setPointerMode((prev) => prev.kind === 'panning' ? POINTER_IDLE : prev);
      }

      if (wasToolPointer) {
        toolPointerIdRef.current = null;
        deps.handleToolUp(e as unknown as React.PointerEvent);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishPointer);
    window.addEventListener('pointercancel', finishPointer);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointer);
      window.removeEventListener('pointercancel', finishPointer);
    };
  }, [flushCursorPosition]);

  // Attach wheel natively (non-passive) so ctrl+wheel can preventDefault
  // the browser's page-zoom — React's synthetic onWheel is passive and
  // preventDefault inside it warns. Window-level with a target containment
  // check so we pick the event up regardless of whether the canvas
  // container was mounted before this hook ran.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const target = e.target as Node | null;
      if (!target || !el.contains(target)) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.pow(1.002, -e.deltaY);
        const vp = useEditorStore.getState().viewport;
        const newZoom = Math.max(0.01, Math.min(64, vp.zoom * factor));
        setZoom(newZoom);
      } else {
        const vp = useEditorStore.getState().viewport;
        setPan(vp.panX - e.deltaX, vp.panY - e.deltaY);
      }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, [containerRef, setZoom, setPan]);

  return {};
}
