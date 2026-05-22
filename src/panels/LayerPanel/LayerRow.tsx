import { useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Folder, GripVertical, Lock, Sparkles, SquareDashed, Unlock, X } from 'lucide-react';
import type { Layer } from '../../types';
import { isGroupLayer } from '../../layers/group-utils';
import { LayerThumbnail } from './LayerThumbnail';
import { MaskThumbnail } from './MaskThumbnail';
import { useEditorStore } from '../../app/editor-store';
import styles from './LayerPanel.module.css';

function hasActiveEffects(layer: Layer): boolean {
  const fx = layer.effects;
  if (fx.stroke.enabled || fx.dropShadow.enabled || fx.outerGlow.enabled || fx.innerGlow.enabled || fx.colorOverlay.enabled) {
    return true;
  }
  if (layer.type === 'group') {
    return layer.adjustments.length > 0;
  }
  return false;
}

export interface LayerRowProps {
  layer: Layer;
  depth: number;
  rowIndex: number;
  isActive: boolean;
  isSelected: boolean;
  isRootGroup: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  isDropTargetEnd: boolean;
  isDropIntoGroup: boolean;
  isEditingOpacity: boolean;
  isMaskEditActive: boolean;
  showEffectsDrawer: boolean;
  onClick: (e: React.MouseEvent, layerId: string) => void;
  onContextMenu: (e: React.MouseEvent, layerId: string) => void;
  onGripDown: (e: React.PointerEvent, ri: number) => void;
  onToggleVisibility: (id: string) => void;
  onToggleGroupCollapsed: (id: string) => void;
  onThumbnailCmdClick: (e: React.MouseEvent, layerId: string) => void;
  onSelectLayer: (id: string) => void;
  onSetMaskEditMode: (on: boolean) => void;
  onToggleLock: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onUpdateOpacity: (id: string, opacity: number) => void;
  onSetEditingOpacity: (id: string | null) => void;
  onRemoveMask: (id: string) => void;
  onConvertMaskToMarquee: (id: string) => void;
  onToggleEffectsDrawer: (layerId: string) => void;
}

export function LayerRow({
  layer, depth, rowIndex,
  isActive, isSelected, isRootGroup, isDragging,
  isDropTarget, isDropTargetEnd, isDropIntoGroup,
  isEditingOpacity, isMaskEditActive, showEffectsDrawer,
  onClick, onContextMenu, onGripDown,
  onToggleVisibility, onToggleGroupCollapsed, onThumbnailCmdClick,
  onSelectLayer, onSetMaskEditMode, onToggleLock,
  onRename, onUpdateOpacity, onSetEditingOpacity,
  onRemoveMask, onConvertMaskToMarquee, onToggleEffectsDrawer,
}: LayerRowProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  return (
    <div className={styles.itemWrapper}>
      <div
        className={[
          styles.item,
          isActive ? styles.active : '',
          !isActive && isSelected ? styles.selected : '',
          layer.locked ? styles.locked : '',
          isGroupLayer(layer) ? styles.groupRow : '',
          isRootGroup ? styles.rootGroup : '',
          isDragging ? styles.dragging : '',
          isDropTarget ? styles.dropTarget : '',
          isDropTargetEnd ? styles.dropTargetEnd : '',
          isDropIntoGroup ? styles.dropIntoGroup : '',
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ '--layer-depth': depth } as React.CSSProperties}
        data-layer-id={layer.id}
        onClick={(e) => onClick(e, layer.id)}
        onContextMenu={(e) => onContextMenu(e, layer.id)}
      >
        {layer.colorTag && (
          <div
            className={styles.colorTagBar}
            data-tag={layer.colorTag}
            aria-hidden="true"
          />
        )}
        {!isRootGroup && (
          <span
            className={styles.dragHandle}
            onPointerDown={(e) => onGripDown(e, rowIndex)}
            role="button"
            aria-label={`Drag to reorder ${layer.name}`}
            tabIndex={0}
          >
            <GripVertical size={12} />
          </span>
        )}
        {isGroupLayer(layer) ? (
          <button
            className={styles.collapseBtn}
            onClick={(e) => {
              e.stopPropagation();
              onToggleGroupCollapsed(layer.id);
            }}
            type="button"
            aria-expanded={!layer.collapsed}
            aria-label={`${layer.collapsed ? 'Expand' : 'Collapse'} group ${layer.name}`}
          >
            {layer.collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </button>
        ) : (
          <div
            className={styles.thumbnail}
            onClick={(e) => onThumbnailCmdClick(e, layer.id)}
          >
            <LayerThumbnail layer={layer} />
          </div>
        )}
        {isGroupLayer(layer) && (
          <Folder size={14} className={styles.folderIcon} />
        )}
        {isRenaming ? (
          <input
            className={styles.nameInput}
            value={renameValue}
            aria-label="Layer name"
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => {
              if (renameValue.trim()) {
                onRename(layer.id, renameValue.trim());
              }
              setIsRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
              } else if (e.key === 'Escape') {
                setIsRenaming(false);
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
              setIsRenaming(true);
              setRenameValue(layer.name);
            }}
          >
            {layer.name}
          </span>
        )}
        {!isRootGroup && (
          <button
            className={styles.opacity}
            onClick={(e) => {
              e.stopPropagation();
              onSetEditingOpacity(isEditingOpacity ? null : layer.id);
            }}
            type="button"
            aria-label={`Opacity ${Math.round(layer.opacity * 100)}% for ${layer.name}`}
            title="Click to adjust opacity"
          >
            {Math.round(layer.opacity * 100)}%
          </button>
        )}
        {!isRootGroup && (
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
        )}
        <button
          className={[
            styles.effectsBtn,
            showEffectsDrawer && isActive ? styles.effectsBtnActive : '',
            hasActiveEffects(layer) ? styles.effectsBtnHasEffects : '',
          ].filter(Boolean).join(' ')}
          onClick={(e) => {
            e.stopPropagation();
            onToggleEffectsDrawer(layer.id);
          }}
          type="button"
          aria-label={isGroupLayer(layer) ? `Group effects for ${layer.name}` : `Layer effects for ${layer.name}`}
          title={isGroupLayer(layer) ? 'Group effects' : 'Layer effects'}
        >
          <Sparkles size={12} />
        </button>
        <button
          className={`${styles.lockBtn} ${layer.locked ? styles.lockBtnActive : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(layer.id);
          }}
          type="button"
          aria-label={layer.locked ? 'Unlock layer' : 'Lock layer'}
        >
          {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
      </div>
      {isEditingOpacity && !isRootGroup && (
        <div className={styles.opacitySlider}>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(layer.opacity * 100)}
            aria-label={`${layer.name} opacity`}
            onPointerDown={() => useEditorStore.getState().pushHistoryMetadata('Change Opacity')}
            onChange={(e) => onUpdateOpacity(layer.id, Number(e.target.value) / 100)}
          />
        </div>
      )}
      {layer.mask && (
        <div className={styles.maskRow} data-mask-layer-id={layer.id}>
          <div
            className={[
              styles.maskThumbnail,
              isMaskEditActive ? styles.maskThumbnailActive : '',
              !layer.mask.enabled ? styles.maskDisabled : '',
            ].filter(Boolean).join(' ')}
            onClick={(e) => {
              e.stopPropagation();
              onSelectLayer(layer.id);
              onSetMaskEditMode(true);
            }}
            role="button"
            tabIndex={0}
            aria-label={`Edit mask for ${layer.name}`}
            title="Click to edit mask"
          >
            <MaskThumbnail layer={layer} />
          </div>
          <span className={styles.maskLabel}>Mask</span>
          <button
            className={styles.maskActionBtn}
            onClick={(e) => {
              e.stopPropagation();
              onConvertMaskToMarquee(layer.id);
            }}
            type="button"
            aria-label="Convert mask to selection"
            title="Convert mask to selection"
          >
            <SquareDashed size={12} />
          </button>
          <button
            className={styles.maskActionBtn}
            onClick={(e) => {
              e.stopPropagation();
              onRemoveMask(layer.id);
              onSetMaskEditMode(false);
            }}
            type="button"
            aria-label="Delete mask"
            title="Delete mask"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
