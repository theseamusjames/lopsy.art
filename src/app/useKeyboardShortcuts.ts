import { useEffect, type RefObject } from 'react';
import { useUIStore } from './ui-store';
import { useEditorStore } from './editor-store';
import { useToolSettingsStore } from './tool-settings-store';
import { strokeCurrentPath } from './useCanvasInteraction';

interface KeyboardShortcutDeps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  setIsSpaceDown: (v: boolean) => void;
  setIsPanning: (v: boolean) => void;
  clearPersistentTransform: () => void;
  nudgeMove: (dx: number, dy: number) => void;
}

export function useKeyboardShortcuts({
  canvasRef,
  setIsSpaceDown,
  setIsPanning,
  clearPersistentTransform,
  nudgeMove,
}: KeyboardShortcutDeps): void {
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const swapColors = useUIStore((s) => s.swapColors);
  const resetColors = useUIStore((s) => s.resetColors);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setPan = useEditorStore((s) => s.setPan);
  const viewport = useEditorStore((s) => s.viewport);
  const docWidth = useEditorStore((s) => s.document.width);
  const docHeight = useEditorStore((s) => s.document.height);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpaceDown(true);
        return;
      }

      if (e.key === 'Escape') {
        const uiState = useUIStore.getState();
        if (uiState.activeTool === 'path' && uiState.pathAnchors.length > 0) {
          uiState.clearPath();
        } else {
          useEditorStore.getState().clearSelection();
          uiState.setTransform(null);
          clearPersistentTransform();
        }
        return;
      }

      if (e.key === 'Enter') {
        const uiState = useUIStore.getState();
        if (uiState.activeTool === 'path' && uiState.pathAnchors.length >= 2) {
          strokeCurrentPath();
        }
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        const editor = useEditorStore.getState();
        const sel = editor.selection;
        const activeId = editor.document.activeLayerId;
        if (!activeId) return;

        if (sel.active && sel.mask) {
          editor.pushHistory();
          const layerData = editor.getOrCreateLayerPixelData(activeId);
          const layer = editor.document.layers.find((l) => l.id === activeId);
          if (!layer) return;
          const result = new ImageData(layerData.width, layerData.height);
          result.data.set(layerData.data);
          for (let y = 0; y < sel.maskHeight; y++) {
            for (let x = 0; x < sel.maskWidth; x++) {
              if ((sel.mask[y * sel.maskWidth + x] ?? 0) < 128) continue;
              const srcX = x - layer.x;
              const srcY = y - layer.y;
              if (srcX < 0 || srcX >= result.width || srcY < 0 || srcY >= result.height) continue;
              const idx = (srcY * result.width + srcX) * 4;
              result.data[idx] = 0;
              result.data[idx + 1] = 0;
              result.data[idx + 2] = 0;
              result.data[idx + 3] = 0;
            }
          }
          editor.updateLayerPixelData(activeId, result);
        } else {
          editor.removeLayer(activeId);
        }
        return;
      }

      // Tool shortcuts
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const toolMap: Record<string, () => void> = {
          v: () => setActiveTool('move'),
          b: () => setActiveTool('brush'),
          n: () => setActiveTool('pencil'),
          e: () => setActiveTool('eraser'),
          g: () => setActiveTool('fill'),
          i: () => setActiveTool('eyedropper'),
          t: () => setActiveTool('text'),
          u: () => setActiveTool('shape'),
          m: () => setActiveTool('marquee-rect'),
          l: () => setActiveTool('lasso'),
          w: () => setActiveTool('wand'),
          c: () => setActiveTool('crop'),
          p: () => setActiveTool('path'),
          s: () => setActiveTool('stamp'),
          o: () => setActiveTool('dodge'),
          x: () => swapColors(),
          d: () => resetColors(),
        };

        const handler = toolMap[e.key.toLowerCase()];
        if (handler) {
          handler();
          return;
        }

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const tool = useUIStore.getState().activeTool;
          if (tool !== 'move') return;
          const ui = useUIStore.getState();
          const amount = ui.showGrid && ui.snapToGrid ? ui.gridSize : 1;
          let dx = 0;
          let dy = 0;
          if (e.key === 'ArrowUp') dy = -amount;
          else if (e.key === 'ArrowDown') dy = amount;
          else if (e.key === 'ArrowLeft') dx = -amount;
          else if (e.key === 'ArrowRight') dx = amount;
          nudgeMove(dx, dy);
          return;
        }

        if (e.key === '[' || e.key === ']') {
          const delta = e.key === ']' ? 1 : -1;
          const tool = useUIStore.getState().activeTool;
          const ts = useToolSettingsStore.getState();
          if (tool === 'brush' || tool === 'dodge') {
            ts.setBrushSize(ts.brushSize + delta);
          } else if (tool === 'pencil') {
            ts.setPencilSize(ts.pencilSize + delta);
          } else if (tool === 'eraser') {
            ts.setEraserSize(ts.eraserSize + delta);
          } else if (tool === 'stamp') {
            ts.setStampSize(ts.stampSize + delta);
          } else if (tool === 'path') {
            ts.setPathStrokeWidth(ts.pathStrokeWidth + delta);
          } else if (tool === 'shape') {
            ts.setShapeStrokeWidth(ts.shapeStrokeWidth + delta);
          }
          return;
        }
      }

      // Zoom shortcuts
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setZoom(Math.min(64, viewport.zoom * 1.5));
        } else if (e.key === '-') {
          e.preventDefault();
          setZoom(Math.max(0.01, viewport.zoom / 1.5));
        } else if (e.key === '0') {
          e.preventDefault();
          const canvas = canvasRef.current;
          if (canvas) {
            const scaleX = canvas.width / docWidth;
            const scaleY = canvas.height / docHeight;
            setZoom(Math.min(scaleX, scaleY) * 0.9);
            setPan(0, 0);
          }
        } else if (e.key === '1') {
          e.preventDefault();
          setZoom(1);
          setPan(0, 0);
        } else if (e.key === 'c') {
          e.preventDefault();
          useEditorStore.getState().copy();
        } else if (e.key === 'x') {
          e.preventDefault();
          useEditorStore.getState().cut();
        } else if (e.key === 'v') {
          e.preventDefault();
          navigator.clipboard.read().then(async (items) => {
            for (const item of items) {
              const imageType = item.types.find((t) => t.startsWith('image/'));
              if (imageType) {
                const blob = await item.getType(imageType);
                const bitmap = await createImageBitmap(blob);
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.drawImage(bitmap, 0, 0);
                  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
                  useEditorStore.getState().pasteImageData(imageData);
                }
                bitmap.close();
                return;
              }
            }
            useEditorStore.getState().paste();
          }).catch(() => {
            useEditorStore.getState().paste();
          });
        } else if (e.key === 'e') {
          e.preventDefault();
          useEditorStore.getState().mergeDown();
        } else if (e.key === 'd') {
          e.preventDefault();
          useEditorStore.getState().clearSelection();
          useUIStore.getState().setTransform(null);
          clearPersistentTransform();
        } else if (e.key === 'z' || e.key === 'Z') {
          e.preventDefault();
          if (e.shiftKey) {
            useEditorStore.getState().redo();
          } else {
            useEditorStore.getState().undo();
          }
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpaceDown(false);
        setIsPanning(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setActiveTool, swapColors, resetColors, setZoom, setPan, viewport.zoom, docWidth, docHeight, canvasRef, setIsSpaceDown, setIsPanning, clearPersistentTransform, nudgeMove]);
}
