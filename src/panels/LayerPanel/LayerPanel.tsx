import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Copy, Folder, FolderPlus, Plus, RectangleCircle, Trash2, Type } from 'lucide-react';
import { IconButton } from '../../components/IconButton/IconButton';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { selectLayerAlpha, convertMaskToMarquee } from './layer-selection';
import { buildFlatDisplayList } from '../../layers/group-utils';
import { useLayerDnd } from './useLayerDnd';
import { LayerRow } from './LayerRow';
import { LayerContextMenu } from './LayerContextMenu';
import { useState } from 'react';
import styles from './LayerPanel.module.css';

interface LayerPanelProps {
  onSelectLayer: (id: string) => void;
}

export function LayerPanel({ onSelectLayer }: LayerPanelProps) {
  const layers = useEditorStore((s) => s.document.layers);
  const activeLayerId = useEditorStore((s) => s.document.activeLayerId);
  const selectedLayerIds = useEditorStore((s) => s.document.selectedLayerIds);
  const onToggleVisibility = useEditorStore((s) => s.toggleLayerVisibility);
  const onAddLayer = useEditorStore((s) => s.addLayer);
  const onReorderLayer = useEditorStore((s) => s.moveLayer);
  const onUpdateOpacity = useEditorStore((s) => s.updateLayerOpacity);
  const addLayerMask = useEditorStore((s) => s.addLayerMask);
  const removeLayerMask = useEditorStore((s) => s.removeLayerMask);
  const duplicateLayer = useEditorStore((s) => s.duplicateLayer);
  const toggleLayerLock = useEditorStore((s) => s.toggleLayerLock);
  const renameLayer = useEditorStore((s) => s.renameLayer);
  const addGroup = useEditorStore((s) => s.addGroup);
  const rasterizeTextLayer = useEditorStore((s) => s.rasterizeTextLayer);
  const toggleGroupCollapsed = useEditorStore((s) => s.toggleGroupCollapsed);
  const moveLayerToGroup = useEditorStore((s) => s.moveLayerToGroup);
  const setLayerColorTag = useEditorStore((s) => s.setLayerColorTag);
  const rootGroupId = useEditorStore((s) => s.document.rootGroupId);
  const layerOrder = useEditorStore((s) => s.document.layerOrder);
  const maskEditMode = useUIStore((s) => s.maskMode === 'layerMask');
  const setMaskEditMode = useUIStore((s) => s.setMaskEditMode);
  const showEffectsDrawer = useUIStore((s) => s.showEffectsDrawer);
  const setShowEffectsDrawer = useUIStore((s) => s.setShowEffectsDrawer);
  const toggleLayerSelection = useEditorStore((s) => s.toggleLayerSelection);
  const selectLayerRange = useEditorStore((s) => s.selectLayerRange);
  const setLayerSelection = useEditorStore((s) => s.setLayerSelection);
  const removeSelectedLayers = useEditorStore((s) => s.removeSelectedLayers);
  const groupSelectedLayers = useEditorStore((s) => s.groupSelectedLayers);
  const panelRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; layerId: string } | null>(null);

  const displayList = useMemo(
    () => buildFlatDisplayList(layers, layerOrder),
    [layers, layerOrder],
  );

  const {
    dragIndex, dropGap, dropIntoGroup,
    editingOpacityId, setEditingOpacityId,
    listRef, handleGripDown,
  } = useLayerDnd({ displayList, layers, onReorderLayer, moveLayerToGroup });

  const isRootGroup = useCallback((layerId: string) => layerId === rootGroupId, [rootGroupId]);

  const handleThumbnailCmdClick = useCallback((e: React.MouseEvent, layerId: string) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    e.stopPropagation();
    selectLayerAlpha(layerId);
  }, []);

  const handleConvertMaskToMarquee = useCallback((layerId: string) => {
    convertMaskToMarquee(layerId);
  }, []);

  const handleLayerClick = useCallback((e: React.MouseEvent, layerId: string) => {
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      toggleLayerSelection(layerId);
    } else if (e.shiftKey && activeLayerId) {
      e.preventDefault();
      selectLayerRange(activeLayerId, layerId);
    } else {
      onSelectLayer(layerId);
      setMaskEditMode(false);
    }
  }, [toggleLayerSelection, selectLayerRange, onSelectLayer, activeLayerId, setMaskEditMode]);

  const handleContextMenu = useCallback((e: React.MouseEvent, layerId: string) => {
    if (isRootGroup(layerId)) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, layerId });
  }, [isRootGroup]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleToggleEffectsDrawer = useCallback((layerId: string) => {
    if (showEffectsDrawer && layerId === activeLayerId) {
      setShowEffectsDrawer(false);
    } else {
      onSelectLayer(layerId);
      setShowEffectsDrawer(true);
    }
  }, [showEffectsDrawer, activeLayerId, setShowEffectsDrawer, onSelectLayer]);

  const handleRemoveMask = useCallback((layerId: string) => {
    removeLayerMask(layerId);
    setMaskEditMode(false);
  }, [removeLayerMask, setMaskEditMode]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement && document.activeElement !== document.body) {
        const target = document.activeElement as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        if (!panel.contains(document.activeElement) && document.activeElement !== document.body) return;
        e.preventDefault();
        const allIds = displayList
          .map((entry) => entry.layer.id)
          .filter((id) => id !== rootGroupId);
        setLayerSelection(allIds);
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!panel.matches(':focus-within') && !panel.contains(document.activeElement)) return;
        if (document.activeElement?.tagName === 'INPUT') return;
        e.preventDefault();
        removeSelectedLayers();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [displayList, rootGroupId, setLayerSelection, removeSelectedLayers]);

  useEffect(() => {
    if (!contextMenu) return;
    const onMouseDown = () => closeContextMenu();
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeContextMenu(); };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu, closeContextMenu]);

  return (
    <>
    <div className={styles.panel} ref={panelRef}>
      <div
        ref={listRef}
        className={styles.list}
      >
        {displayList.map(({ layer, depth }, ri) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            depth={depth}
            rowIndex={ri}
            isActive={layer.id === activeLayerId}
            isSelected={layer.id !== activeLayerId && selectedLayerIds.includes(layer.id)}
            isRootGroup={isRootGroup(layer.id)}
            isDragging={dragIndex === ri}
            isDropTarget={dropGap !== null && dropGap === ri && dropGap !== dragIndex && dropGap !== (dragIndex ?? -1) + 1}
            isDropTargetEnd={dropGap !== null && dropGap === displayList.length && ri === displayList.length - 1 && dropGap !== (dragIndex ?? -1) + 1}
            isDropIntoGroup={dropIntoGroup === layer.id}
            isEditingOpacity={editingOpacityId === layer.id}
            isMaskEditActive={maskEditMode && layer.id === activeLayerId}
            showEffectsDrawer={showEffectsDrawer}
            onClick={handleLayerClick}
            onContextMenu={handleContextMenu}
            onGripDown={handleGripDown}
            onToggleVisibility={onToggleVisibility}
            onToggleGroupCollapsed={toggleGroupCollapsed}
            onThumbnailCmdClick={handleThumbnailCmdClick}
            onSelectLayer={onSelectLayer}
            onSetMaskEditMode={setMaskEditMode}
            onToggleLock={toggleLayerLock}
            onRename={renameLayer}
            onUpdateOpacity={onUpdateOpacity}
            onSetEditingOpacity={setEditingOpacityId}
            onRemoveMask={handleRemoveMask}
            onConvertMaskToMarquee={handleConvertMaskToMarquee}
            onToggleEffectsDrawer={handleToggleEffectsDrawer}
          />
        ))}
      </div>
      <div className={styles.toolbar}>
        <IconButton icon={<Plus size={16} />} label="Add Layer" onClick={onAddLayer} />
        <IconButton icon={<FolderPlus size={16} />} label="New Group" onClick={() => addGroup()} />
        {selectedLayerIds.filter((id) => id !== rootGroupId).length >= 2 && (
          <IconButton icon={<Folder size={16} />} label="Group Layers" onClick={() => groupSelectedLayers()} />
        )}
        <IconButton
          icon={<Copy size={16} />}
          label="Duplicate Layer"
          onClick={() => { if (activeLayerId && !isRootGroup(activeLayerId)) duplicateLayer(); }}
          disabled={!activeLayerId || isRootGroup(activeLayerId ?? '')}
        />
        {activeLayerId && (() => {
          const activeLayer = layers.find((l) => l.id === activeLayerId);
          if (!activeLayer || activeLayer.mask) return null;
          return <IconButton icon={<RectangleCircle size={16} />} label="Add Mask" onClick={() => addLayerMask(activeLayerId)} />;
        })()}
        {activeLayerId && (() => {
          const activeLayer = layers.find((l) => l.id === activeLayerId);
          if (!activeLayer || activeLayer.type !== 'text') return null;
          return <IconButton icon={<Type size={16} />} label="Rasterize Layer" onClick={() => rasterizeTextLayer()} />;
        })()}
        <div className={styles.toolbarSpacer} />
        <IconButton
          icon={<Trash2 size={16} />}
          label="Delete Layer"
          onClick={() => {
            const deletable = selectedLayerIds.filter((id) => !isRootGroup(id));
            if (deletable.length > 0) removeSelectedLayers();
          }}
          disabled={layers.length <= 1 || selectedLayerIds.filter((id) => !isRootGroup(id)).length === 0}
        />
      </div>
    </div>
    {contextMenu && (
      <LayerContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        currentTag={layers.find((l) => l.id === contextMenu.layerId)?.colorTag ?? null}
        onSetColorTag={(tag) => {
          setLayerColorTag(contextMenu.layerId, tag);
          closeContextMenu();
        }}
        onClose={closeContextMenu}
      />
    )}
    </>
  );
}
