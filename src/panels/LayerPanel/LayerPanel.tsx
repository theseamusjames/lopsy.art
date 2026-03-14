import { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, GripVertical, Plus, RectangleCircle, Sparkles, SquareDashed, Trash2, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton/IconButton';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { selectionBounds } from '../../selection/selection';
import { createTransformState } from '../../tools/transform/transform';
import type { Layer } from '../../types';
import styles from './LayerPanel.module.css';

interface LayerPanelProps {
  layers: Layer[];
  activeLayerId: string | null;
  onSelectLayer: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onAddLayer: () => void;
  onRemoveLayer: (id: string) => void;
  onReorderLayer: (fromIndex: number, toIndex: number) => void;
  onUpdateOpacity: (id: string, opacity: number) => void;
  collapsed?: boolean;
}

function LayerThumbnail({ layer }: { layer: Layer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderVersion = useEditorStore((s) => s.renderVersion);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const thumbSize = 24;
    canvas.width = thumbSize;
    canvas.height = thumbSize;

    const pixelData = useEditorStore.getState().layerPixelData.get(layer.id);
    if (!pixelData) {
      ctx.clearRect(0, 0, thumbSize, thumbSize);
      return;
    }

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = pixelData.width;
    tempCanvas.height = pixelData.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) return;
    tempCtx.putImageData(pixelData, 0, 0);

    ctx.clearRect(0, 0, thumbSize, thumbSize);
    const scale = Math.min(thumbSize / pixelData.width, thumbSize / pixelData.height);
    const w = pixelData.width * scale;
    const h = pixelData.height * scale;
    ctx.drawImage(tempCanvas, (thumbSize - w) / 2, (thumbSize - h) / 2, w, h);
  }, [layer.id, renderVersion]);

  return <canvas ref={canvasRef} className={styles.thumbnailCanvas} />;
}

function MaskThumbnail({ layer }: { layer: Layer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mask = layer.mask;
  const renderVersion = useEditorStore((s) => s.renderVersion);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mask) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 20;
    canvas.height = 20;

    const imgData = ctx.createImageData(20, 20);
    const scaleX = mask.width / 20;
    const scaleY = mask.height / 20;
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const srcX = Math.floor(x * scaleX);
        const srcY = Math.floor(y * scaleY);
        const val = mask.data[srcY * mask.width + srcX] ?? 0;
        const idx = (y * 20 + x) * 4;
        imgData.data[idx] = val;
        imgData.data[idx + 1] = val;
        imgData.data[idx + 2] = val;
        imgData.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, [mask, renderVersion]);

  if (!mask) return null;

  return <canvas ref={canvasRef} />;
}

export function LayerPanel({
  layers,
  activeLayerId,
  onSelectLayer,
  onToggleVisibility,
  onAddLayer,
  onRemoveLayer,
  onReorderLayer,
  onUpdateOpacity,
  collapsed = false,
}: LayerPanelProps) {
  const addLayerMask = useEditorStore((s) => s.addLayerMask);
  const removeLayerMask = useEditorStore((s) => s.removeLayerMask);
  const maskEditMode = useUIStore((s) => s.maskEditMode);
  const setMaskEditMode = useUIStore((s) => s.setMaskEditMode);
  const showEffectsDrawer = useUIStore((s) => s.showEffectsDrawer);
  const setShowEffectsDrawer = useUIStore((s) => s.setShowEffectsDrawer);

  const handleThumbnailCmdClick = useCallback((e: React.MouseEvent, layerId: string) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.stopPropagation();
    const editorState = useEditorStore.getState();
    const layer = editorState.document.layers.find((l) => l.id === layerId);
    if (!layer) return;
    const pixelData = editorState.layerPixelData.get(layerId);
    if (!pixelData) return;

    const { width: docW, height: docH } = editorState.document;
    const selMask = new Uint8ClampedArray(docW * docH);
    for (let y = 0; y < pixelData.height; y++) {
      for (let x = 0; x < pixelData.width; x++) {
        const alpha = pixelData.data[(y * pixelData.width + x) * 4 + 3] ?? 0;
        if (alpha < 1) continue;
        const docX = x + layer.x;
        const docY = y + layer.y;
        if (docX >= 0 && docX < docW && docY >= 0 && docY < docH) {
          selMask[docY * docW + docX] = alpha;
        }
      }
    }
    const bounds = selectionBounds(selMask, docW, docH);
    if (bounds) {
      editorState.setSelection(bounds, selMask, docW, docH);
      useUIStore.getState().setTransform(createTransformState(bounds));
    }
  }, []);

  const handleConvertMaskToMarquee = useCallback((layerId: string) => {
    const editorState = useEditorStore.getState();
    const layer = editorState.document.layers.find((l) => l.id === layerId);
    if (!layer?.mask) return;
    const { mask } = layer;
    const { width: docW, height: docH } = editorState.document;
    const selMask = new Uint8ClampedArray(docW * docH);
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        const docX = x + layer.x;
        const docY = y + layer.y;
        if (docX >= 0 && docX < docW && docY >= 0 && docY < docH) {
          selMask[docY * docW + docX] = 255 - (mask.data[y * mask.width + x] ?? 0);
        }
      }
    }
    const bounds = selectionBounds(selMask, docW, docH);
    if (bounds) {
      editorState.setSelection(bounds, selMask, docW, docH);
      useUIStore.getState().setTransform(createTransformState(bounds));
    }
    setMaskEditMode(false);
  }, [setMaskEditMode]);

  const reversedLayers = [...layers].reverse();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const [editingOpacityId, setEditingOpacityId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ from: number; gap: number } | null>(null);

  const handleGripDown = useCallback((e: React.PointerEvent, ri: number) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { from: ri, gap: ri };
    setDragIndex(ri);
    setDropGap(ri);

    const onMove = (ev: PointerEvent) => {
      const list = listRef.current;
      if (!list || !dragRef.current) return;
      const items = list.querySelectorAll(`.${styles.itemWrapper}`);
      // Gap positions: 0=before first, 1=between 0&1, ..., N=after last
      let gap = items.length;
      for (let i = 0; i < items.length; i++) {
        const rect = items[i]!.getBoundingClientRect();
        if (ev.clientY < rect.top + rect.height / 2) {
          gap = i;
          break;
        }
      }
      dragRef.current.gap = gap;
      setDropGap(gap);
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      const drag = dragRef.current;
      dragRef.current = null;
      setDragIndex(null);
      setDropGap(null);
      if (!drag) return;
      const { from, gap } = drag;
      // Dropping at gap === from or from+1 is a no-op (same position)
      if (gap === from || gap === from + 1) return;
      const fromArrayIdx = layers.length - 1 - from;
      const rawToArrayIdx = layers.length - gap;
      const toArrayIdx = rawToArrayIdx > fromArrayIdx ? rawToArrayIdx - 1 : rawToArrayIdx;
      onReorderLayer(fromArrayIdx, toArrayIdx);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [layers.length, onReorderLayer]);

  return (
    <div className={styles.panel}>
      <div
        ref={listRef}
        className={collapsed ? styles.listCollapsed : styles.list}
      >
        {reversedLayers.map((layer, ri) => (
          <div key={layer.id} className={styles.itemWrapper}>
            <div
              className={[
                styles.item,
                layer.id === activeLayerId ? styles.active : '',
                dragIndex === ri ? styles.dragging : '',
                dragIndex !== null && dropGap === ri && dropGap !== dragIndex && dropGap !== dragIndex + 1
                  ? styles.dropTarget : '',
                dragIndex !== null && dropGap === reversedLayers.length && ri === reversedLayers.length - 1 && dropGap !== dragIndex + 1
                  ? styles.dropTargetEnd : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectLayer(layer.id)}
            >
              <span
                className={styles.dragHandle}
                onPointerDown={(e) => handleGripDown(e, ri)}
              >
                <GripVertical size={12} />
              </span>
              <div
                className={styles.thumbnail}
                onClick={(e) => handleThumbnailCmdClick(e, layer.id)}
              >
                <LayerThumbnail layer={layer} />
              </div>
              <span className={styles.name}>{layer.name}</span>
              <button
                className={`${styles.effectsBtn} ${showEffectsDrawer && layer.id === activeLayerId ? styles.effectsBtnActive : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectLayer(layer.id);
                  if (!showEffectsDrawer) {
                    setShowEffectsDrawer(true);
                  }
                }}
                type="button"
                title="Layer effects"
              >
                <Sparkles size={12} />
              </button>
              <span
                className={styles.opacity}
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingOpacityId(editingOpacityId === layer.id ? null : layer.id);
                }}
                title="Click to adjust opacity"
              >
                {Math.round(layer.opacity * 100)}%
              </span>
              <button
                className={styles.visibilityBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(layer.id);
                }}
                type="button"
                aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
              >
                {layer.visible ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
            {editingOpacityId === layer.id && (
              <div className={styles.opacitySlider}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={Math.round(layer.opacity * 100)}
                  onPointerDown={() => useEditorStore.getState().pushHistory('Change Opacity')}
                  onChange={(e) => onUpdateOpacity(layer.id, Number(e.target.value) / 100)}
                />
              </div>
            )}
            {layer.mask && (
              <div className={styles.maskRow}>
                <div
                  className={[
                    styles.maskThumbnail,
                    maskEditMode && layer.id === activeLayerId ? styles.maskThumbnailActive : '',
                    !layer.mask.enabled ? styles.maskDisabled : '',
                  ].filter(Boolean).join(' ')}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectLayer(layer.id);
                    setMaskEditMode(!maskEditMode || layer.id !== activeLayerId);
                  }}
                  title="Click to edit mask"
                >
                  <MaskThumbnail layer={layer} />
                </div>
                <span className={styles.maskLabel}>Mask</span>
                <button
                  className={styles.maskActionBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleConvertMaskToMarquee(layer.id);
                  }}
                  type="button"
                  title="Convert mask to selection"
                >
                  <SquareDashed size={12} />
                </button>
                <button
                  className={styles.maskActionBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeLayerMask(layer.id);
                    setMaskEditMode(false);
                  }}
                  type="button"
                  title="Delete mask"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className={styles.toolbar}>
        <IconButton
          icon={<Plus size={16} />}
          label="Add Layer"
          onClick={onAddLayer}
        />
        <IconButton
          icon={<Trash2 size={16} />}
          label="Delete Layer"
          onClick={() => {
            if (activeLayerId) onRemoveLayer(activeLayerId);
          }}
          disabled={layers.length <= 1}
        />
        {activeLayerId && (() => {
          const activeLayer = layers.find((l) => l.id === activeLayerId);
          if (!activeLayer || activeLayer.mask) return null;
          return (
            <IconButton
              icon={<RectangleCircle size={16} />}
              label="Add Mask"
              onClick={() => addLayerMask(activeLayerId)}
            />
          );
        })()}
      </div>
    </div>
  );
}
