import { useCallback, useRef, useState } from 'react';
import { Eye, EyeOff, GripVertical, Plus, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/IconButton/IconButton';
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
}

export function LayerPanel({
  layers,
  activeLayerId,
  onSelectLayer,
  onToggleVisibility,
  onAddLayer,
  onRemoveLayer,
  onReorderLayer,
}: LayerPanelProps) {
  const reversedLayers = [...layers].reverse();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragStartRef = useRef<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, reversedIdx: number) => {
    dragStartRef.current = reversedIdx;
    setDragIndex(reversedIdx);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, reversedIdx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropIndex(reversedIdx);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, reversedIdx: number) => {
      e.preventDefault();
      if (dragStartRef.current !== null && dragStartRef.current !== reversedIdx) {
        const fromOrderIdx = layers.length - 1 - dragStartRef.current;
        const toOrderIdx = layers.length - 1 - reversedIdx;
        onReorderLayer(fromOrderIdx, toOrderIdx);
      }
      setDragIndex(null);
      setDropIndex(null);
      dragStartRef.current = null;
    },
    [layers.length, onReorderLayer],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDropIndex(null);
    dragStartRef.current = null;
  }, []);

  return (
    <div className={styles.panel}>
      <div className={styles.list}>
        {reversedLayers.map((layer, ri) => (
          <div
            key={layer.id}
            className={[
              styles.item,
              layer.id === activeLayerId ? styles.active : '',
              dragIndex === ri ? styles.dragging : '',
              dropIndex === ri ? styles.dropTarget : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onSelectLayer(layer.id)}
            draggable
            onDragStart={(e) => handleDragStart(e, ri)}
            onDragOver={(e) => handleDragOver(e, ri)}
            onDrop={(e) => handleDrop(e, ri)}
            onDragEnd={handleDragEnd}
          >
            <span className={styles.dragHandle}>
              <GripVertical size={12} />
            </span>
            <div className={styles.thumbnail} />
            <span className={styles.name}>{layer.name}</span>
            <span className={styles.opacity}>
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
      </div>
    </div>
  );
}
