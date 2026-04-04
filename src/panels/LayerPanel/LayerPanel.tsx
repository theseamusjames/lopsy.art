import { useCallback, useRef, useState } from 'react';
import { Eye, EyeOff, GripVertical, Lock, Plus, RectangleCircle, Sparkles, SquareDashed, Trash2, Unlock, X } from 'lucide-react';
import { IconButton } from '../../components/IconButton/IconButton';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import type { Layer } from '../../types';
import { LayerThumbnail } from './LayerThumbnail';
import { MaskThumbnail } from './MaskThumbnail';
import { selectLayerAlpha, convertMaskToMarquee } from './layer-selection';
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
  const toggleLayerLock = useEditorStore((s) => s.toggleLayerLock);
  const renameLayer = useEditorStore((s) => s.renameLayer);
  const maskEditMode = useUIStore((s) => s.maskEditMode);
  const setMaskEditMode = useUIStore((s) => s.setMaskEditMode);
  const showEffectsDrawer = useUIStore((s) => s.showEffectsDrawer);
  const setShowEffectsDrawer = useUIStore((s) => s.setShowEffectsDrawer);
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleThumbnailCmdClick = useCallback((e: React.MouseEvent, layerId: string) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.stopPropagation();
    selectLayerAlpha(layerId);
  }, []);

  const handleConvertMaskToMarquee = useCallback((layerId: string) => {
    convertMaskToMarquee(layerId);
  }, []);

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
                layer.locked ? styles.locked : '',
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
              {renamingLayerId === layer.id ? (
                <input
                  className={styles.nameInput}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    if (renameValue.trim()) {
                      renameLayer(layer.id, renameValue.trim());
                    }
                    setRenamingLayerId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      (e.target as HTMLInputElement).blur();
                    } else if (e.key === 'Escape') {
                      setRenamingLayerId(null);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span
                  className={styles.name}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenamingLayerId(layer.id);
                    setRenameValue(layer.name);
                  }}
                >
                  {layer.name}
                </span>
              )}
              <button
                className={`${styles.effectsBtn} ${showEffectsDrawer && layer.id === activeLayerId ? styles.effectsBtnActive : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (showEffectsDrawer && layer.id === activeLayerId) {
                    setShowEffectsDrawer(false);
                  } else {
                    onSelectLayer(layer.id);
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
                className={`${styles.lockBtn} ${layer.locked ? styles.lockBtnActive : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLayerLock(layer.id);
                }}
                type="button"
                aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}
              >
                {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
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
