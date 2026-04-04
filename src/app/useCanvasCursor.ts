import { useCallback, useEffect } from 'react';
import type { RefObject } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { useToolSettingsStore } from './tool-settings-store';
import { hitTestHandle, getCursorForHandle } from '../tools/transform/transform';
import type { TransformHandle } from '../tools/transform/transform';
import type { ToolId, Point } from '../types';
import styles from './App.module.css';

function isPathEditMode(): boolean {
  const ui = useUIStore.getState();
  const editor = useEditorStore.getState();
  return ui.activeTool === 'path' && editor.selectedPathId !== null;
}

type BrushTool = 'brush' | 'pencil' | 'eraser' | 'stamp' | 'dodge';

const BRUSH_TOOLS: ReadonlySet<string> = new Set<BrushTool>([
  'brush',
  'pencil',
  'eraser',
  'stamp',
  'dodge',
]);

function isBrushTool(tool: ToolId): tool is BrushTool {
  return BRUSH_TOOLS.has(tool);
}

function getToolSize(tool: BrushTool, settings: ReturnType<typeof useToolSettingsStore.getState>): number {
  switch (tool) {
    case 'brush':
    case 'dodge':
      return settings.brushSize;
    case 'pencil':
      return settings.pencilSize;
    case 'eraser':
      return settings.eraserSize;
    case 'stamp':
      return settings.stampSize;
  }
}

function getCursorClassForTool(tool: ToolId): string {
  switch (tool) {
    case 'move':
      return styles.canvasMove ?? '';
    case 'text':
      return styles.canvasText ?? '';
    case 'brush':
    case 'pencil':
    case 'eraser':
    case 'stamp':
    case 'dodge':
      return styles.canvasNone ?? '';
    case 'marquee-rect':
    case 'marquee-ellipse':
    case 'lasso':
    case 'lasso-poly':
    case 'wand':
    case 'fill':
    case 'gradient':
    case 'eyedropper':
    case 'shape':
    case 'crop':
    case 'path':
      return styles.canvasCrosshair ?? '';
    default:
      return styles.canvasCrosshair ?? '';
  }
}

const HANDLE_CURSOR_MAP: Record<string, string> = {
  'nwse-resize': styles.canvasNwseResize ?? '',
  'ns-resize': styles.canvasNsResize ?? '',
  'nesw-resize': styles.canvasNeswResize ?? '',
  'ew-resize': styles.canvasEwResize ?? '',
  'crosshair': styles.canvasCrosshair ?? '',
};

function getCursorClassForHandle(handle: TransformHandle): string {
  const cursorValue = getCursorForHandle(handle);
  return HANDLE_CURSOR_MAP[cursorValue] ?? styles.canvasPointer ?? '';
}

export function useCanvasCursor(
  containerRef: RefObject<HTMLDivElement | null>,
  isPanning: boolean,
  isSpaceDown: boolean,
): {
  updateHoveredHandle: (canvasPos: Point) => void;
} {
  const activeTool = useUIStore((s) => s.activeTool);
  const hoveredHandle = useUIStore((s) => s.activeTransformHandle);
  const transform = useUIStore((s) => s.transform);
  const selectionActive = useEditorStore((s) => s.selection.active);
  const selectedPathId = useEditorStore((s) => s.selectedPathId);

  // Compute cursor class
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cursorClass: string;

    if (isPanning || isSpaceDown) {
      cursorClass = styles.canvasGrab ?? '';
    } else if (hoveredHandle) {
      cursorClass = getCursorClassForHandle(hoveredHandle);
    } else if (isPathEditMode()) {
      cursorClass = styles.canvasDefault ?? '';
    } else {
      cursorClass = getCursorClassForTool(activeTool);
    }

    // Remove all cursor classes, then add the current one
    const allCursorClasses = [
      styles.canvasCrosshair,
      styles.canvasNone,
      styles.canvasMove,
      styles.canvasText,
      styles.canvasGrab,
      styles.canvasPointer,
      styles.canvasNwseResize,
      styles.canvasNsResize,
      styles.canvasNeswResize,
      styles.canvasEwResize,
      styles.canvasDefault,
    ].filter(Boolean) as string[];

    container.classList.remove(...allCursorClasses);
    if (cursorClass) {
      container.classList.add(cursorClass);
    }
  }, [containerRef, isPanning, isSpaceDown, activeTool, hoveredHandle, transform, selectionActive, selectedPathId]);

  // Hit test transform handles on hover
  const updateHoveredHandle = useCallback(
    (canvasPos: Point) => {
      const uiState = useUIStore.getState();
      const editorState = useEditorStore.getState();
      const currentTransform = uiState.transform;

      if (currentTransform && editorState.selection.active) {
        const handleRadius = 8 / editorState.viewport.zoom;
        const hit = hitTestHandle(canvasPos, currentTransform, handleRadius);
        if (hit !== uiState.activeTransformHandle) {
          uiState.setActiveTransformHandle(hit);
        }
      } else if (uiState.activeTransformHandle !== null) {
        uiState.setActiveTransformHandle(null);
      }
    },
    [],
  );

  return { updateHoveredHandle };
}

export interface BrushCursorInfo {
  readonly size: number;
  readonly shape: 'circle' | 'square';
}

export function getBrushCursorInfo(tool: ToolId): BrushCursorInfo | null {
  if (!isBrushTool(tool)) return null;
  const settings = useToolSettingsStore.getState();
  return {
    size: getToolSize(tool, settings),
    shape: tool === 'pencil' ? 'square' : 'circle',
  };
}
