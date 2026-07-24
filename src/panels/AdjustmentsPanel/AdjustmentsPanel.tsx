import { useState } from 'react';

import { Eye, EyeOff, X, ChevronDown, ChevronRight, GripVertical, Trash2, Plus } from 'lucide-react';
import { IconButton } from '../../components/IconButton/IconButton';
import type { DragProps } from '../../app/hooks/useDraggablePanel';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import type { GroupLayer } from '../../types';
import type {
  AdjustmentNode,
  AdjustmentNodeType,
} from '../../types/adjustment-nodes';
import {
  ADJUSTMENT_NODE_LABELS,
} from '../../filters/adjustment-node-utils';
import { isAdjustmentAllowedInMode } from '../../utils/color-mode-capabilities';
import { NODE_CONTROLS_MAP } from './controls/node-controls-map';
import styles from './AdjustmentsPanel.module.css';

/** Node types available in the Add menu. New types (color-balance, etc.) are
 *  listed with a "(coming soon)" suffix but are still addable — their controls
 *  will show a placeholder until GPU shaders are wired up. */
const ADD_MENU_TYPES: AdjustmentNodeType[] = [
  'exposure',
  'contrast',
  'highlights-shadows',
  'saturation',
  'vignette',
  'curves',
  'levels',
  'hue-saturation',
  'color-balance',
  'invert',
  'black-white',
  'photo-filter',
  'channel-mixer',
  'gradient-map',
];

const LEGACY_ONLY_TYPES = new Set<AdjustmentNodeType>();

function useActiveGroup(): GroupLayer | null {
  return useEditorStore((s) => {
    const activeId = s.document.activeLayerId;
    if (activeId) {
      const active = s.document.layers.find((l) => l.id === activeId);
      if (active?.type === 'group') return active as GroupLayer;
    }
    const rootId = s.document.rootGroupId;
    if (rootId) {
      const root = s.document.layers.find((l) => l.id === rootId);
      if (root?.type === 'group') return root as GroupLayer;
    }
    return null;
  });
}

interface AdjustmentsPanelProps {
  showHeader?: boolean;
  dragProps?: DragProps;
}

export function AdjustmentsPanel({ showHeader, dragProps }: AdjustmentsPanelProps = {}) {
  const group = useActiveGroup();
  const setGroupAdjustmentsEnabled = useEditorStore((s) => s.setGroupAdjustmentsEnabled);
  const addAdjustmentNode = useEditorStore((s) => s.addAdjustmentNode);
  const removeAdjustmentNode = useEditorStore((s) => s.removeAdjustmentNode);
  const updateAdjustmentNode = useEditorStore((s) => s.updateAdjustmentNode);
  const toggleAdjustmentNode = useEditorStore((s) => s.toggleAdjustmentNode);
  const reorderAdjustmentNodes = useEditorStore((s) => s.reorderAdjustmentNodes);
  const setShowEffectsDrawer = useUIStore((s) => s.setShowEffectsDrawer);
  const colorMode = useEditorStore((s) => s.document.colorMode);

  const [showAddMenu, setShowAddMenu] = useState(false);
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  if (!group) return null;

  const nodes = group.adjustments;
  const adjustmentsEnabled = group.adjustmentsEnabled ?? true;

  const handleAddNode = (type: AdjustmentNodeType) => {
    setShowAddMenu(false);
    addAdjustmentNode(group.id, type);
    const updated = useEditorStore.getState().document.layers.find(
      (l) => l.id === group.id && l.type === 'group',
    ) as GroupLayer | undefined;
    const lastNode = updated?.adjustments[updated.adjustments.length - 1];
    if (lastNode) setExpandedNodeId(lastNode.id);
  };

  const handleDragStart = (idx: number) => {
    setDraggedIndex(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIndex(idx);
  };

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIdx) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }
    const ids = nodes.map((n) => n.id);
    const [moved] = ids.splice(draggedIndex, 1);
    if (moved !== undefined) {
      ids.splice(dropIdx, 0, moved);
    }
    reorderAdjustmentNodes(group.id, ids);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className={styles.panel}>
      {showHeader && (
        <div className={styles.header} {...dragProps}>
          <span className={styles.headerTitle}>{group.name}</span>
          <IconButton
            icon={<X size={14} />}
            label="Close"
            onClick={() => setShowEffectsDrawer(false)}
          />
        </div>
      )}
      <div className={styles.scrollArea}>
        {nodes.length === 0 && (
          <p className={styles.emptyHint}>No adjustments yet. Add one below.</p>
        )}
        {nodes.map((node, idx) => (
          <AdjustmentNodeRow
            key={node.id}
            node={node}
            isExpanded={expandedNodeId === node.id}
            isDragOver={dragOverIndex === idx}
            onToggleExpand={() => setExpandedNodeId(expandedNodeId === node.id ? null : node.id)}
            onToggleEnabled={() => toggleAdjustmentNode(group.id, node.id)}
            onRemove={() => removeAdjustmentNode(group.id, node.id)}
            onChange={(params) => updateAdjustmentNode(group.id, node.id, params)}
            onDragStart={() => handleDragStart(idx)}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>
      <div className={styles.footer}>
        <div className={styles.addMenuWrapper}>
          <button
            type="button"
            className={styles.textBtn}
            onClick={() => setShowAddMenu(!showAddMenu)}
            aria-label="Add Adjustment"
            aria-expanded={showAddMenu}
          >
            <Plus size={12} className={styles.addIcon} />
            Add Adjustment
          </button>
          {showAddMenu && (
            <div className={styles.addMenu} role="menu">
              {ADD_MENU_TYPES.filter((type) => isAdjustmentAllowedInMode(type, colorMode)).map((type) => (
                <button
                  key={type}
                  type="button"
                  role="menuitem"
                  className={styles.addMenuItem}
                  onClick={() => handleAddNode(type)}
                >
                  {ADJUSTMENT_NODE_LABELS[type]}
                  {LEGACY_ONLY_TYPES.has(type) && (
                    <span className={styles.comingSoon}> (soon)</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className={`${styles.iconBtn} ${!adjustmentsEnabled ? styles.iconBtnOff : ''}`}
          onClick={() => setGroupAdjustmentsEnabled(group.id, !adjustmentsEnabled)}
          aria-label={adjustmentsEnabled ? 'Disable adjustments' : 'Enable adjustments'}
        >
          {adjustmentsEnabled ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>
    </div>
  );
}

// ─── Node row ───────────────────────────────────────────────────────────────

interface NodeRowProps {
  node: AdjustmentNode;
  isExpanded: boolean;
  isDragOver: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onRemove: () => void;
  onChange: (params: Partial<AdjustmentNode>) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function AdjustmentNodeRow({
  node, isExpanded, isDragOver,
  onToggleExpand, onToggleEnabled, onRemove, onChange,
  onDragStart, onDragOver, onDrop, onDragEnd,
}: NodeRowProps) {
  return (
    <div
      className={`${styles.nodeRow} ${isDragOver ? styles.nodeRowDragOver : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        className={styles.nodeHeader}
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <span className={styles.nodeGrip} aria-hidden="true">
          <GripVertical size={12} />
        </span>
        <button type="button" className={styles.nodeExpandBtn} onClick={onToggleExpand} aria-label={isExpanded ? 'Collapse' : 'Expand'}>
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className={`${styles.nodeLabel} ${!node.enabled ? styles.nodeLabelDisabled : ''}`}>
          {ADJUSTMENT_NODE_LABELS[node.type]}
        </span>
        <button
          type="button"
          className={`${styles.nodeIconBtn} ${!node.enabled ? styles.iconBtnOff : ''}`}
          onClick={onToggleEnabled}
          aria-label={node.enabled ? 'Disable node' : 'Enable node'}
        >
          {node.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
        <button
          type="button"
          className={styles.nodeIconBtn}
          onClick={onRemove}
          aria-label="Remove node"
        >
          <Trash2 size={12} />
        </button>
      </div>
      {isExpanded && (
        <div className={styles.nodeControls}>
          <NodeControls node={node} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

// ─── Per-type controls ───────────────────────────────────────────────────────

interface NodeControlsProps {
  node: AdjustmentNode;
  onChange: (params: Partial<AdjustmentNode>) => void;
}

function NodeControls({ node, onChange }: NodeControlsProps) {
  if (node.type === 'invert') {
    return <p className={styles.invertNote}>No parameters — the layer is inverted when enabled.</p>;
  }
  const Controls = NODE_CONTROLS_MAP[node.type];
  if (!Controls) return null;
  return <Controls node={node} onChange={onChange} />;
}
