import { useState } from 'react';
import { Eye, EyeOff, X, ChevronDown, ChevronRight, Trash2, Plus } from 'lucide-react';
import { Slider } from '../../components/Slider/Slider';
import { IconButton } from '../../components/IconButton/IconButton';
import type { DragProps } from '../../app/hooks/useDraggablePanel';
import { CurveEditor } from '../../components/CurveEditor/CurveEditor';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import {
  IDENTITY_POINTS,
  isIdentityCurve,
  type CurveChannel,
  type CurvePoint,
  type Curves,
} from '../../filters/curves';
import { IDENTITY_LEVELS } from '../../filters/levels';
import type { Levels } from '../../filters/levels';
import { LevelsEditor } from './LevelsEditor';
import type { GroupLayer } from '../../types';
import type {
  AdjustmentNode,
  AdjustmentNodeType,
  ExposureNode,
  ContrastNode,
  HighlightsShadowsNode,
  SaturationNode,
  VignetteNode,
  CurvesNode,
  LevelsNode,
} from '../../types/adjustment-nodes';
import {
  ADJUSTMENT_NODE_LABELS,
} from '../../filters/adjustment-node-utils';
import styles from './AdjustmentsPanel.module.css';

const CHANNEL_COLORS: Record<CurveChannel, string> = {
  rgb: '#e0e0e0',
  r: '#ff5e5e',
  g: '#5eff7e',
  b: '#5e9eff',
};

const CHANNEL_LABELS: Record<CurveChannel, string> = {
  rgb: 'RGB',
  r: 'R',
  g: 'G',
  b: 'B',
};

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

const LEGACY_ONLY_TYPES = new Set<AdjustmentNodeType>([
  'color-balance',
  'gradient-map',
  'black-white',
  'photo-filter',
  'channel-mixer',
]);

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
            <Plus size={12} style={{ marginRight: 4 }} />
            Add Adjustment
          </button>
          {showAddMenu && (
            <div className={styles.addMenu} role="menu">
              {ADD_MENU_TYPES.map((type) => (
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
  switch (node.type) {
    case 'exposure':
      return <ExposureControls node={node} onChange={onChange} />;
    case 'contrast':
      return <ContrastControls node={node} onChange={onChange} />;
    case 'highlights-shadows':
      return <HighlightsShadowsControls node={node} onChange={onChange} />;
    case 'saturation':
      return <SaturationControls node={node} onChange={onChange} />;
    case 'vignette':
      return <VignetteControls node={node} onChange={onChange} />;
    case 'curves':
      return <CurvesControls node={node} onChange={onChange} />;
    case 'levels':
      return <LevelsControls node={node} onChange={onChange} />;
    default:
      return <p className={styles.comingSoonNote}>Controls for this adjustment type are coming soon.</p>;
  }
}

function ExposureControls({ node, onChange }: { node: ExposureNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  return (
    <div className={styles.sliders}>
      <Slider label="Exposure" value={node.exposure} min={-5} max={5} step={0.1} defaultValue={0}
        onChange={(v) => onChange({ exposure: v })} />
    </div>
  );
}

function ContrastControls({ node, onChange }: { node: ContrastNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  return (
    <div className={styles.sliders}>
      <Slider label="Contrast" value={node.contrast} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ contrast: v })} />
    </div>
  );
}

function HighlightsShadowsControls({ node, onChange }: { node: HighlightsShadowsNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  return (
    <div className={styles.sliders}>
      <Slider label="Highlights" value={node.highlights} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ highlights: v })} />
      <Slider label="Shadows" value={node.shadows} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ shadows: v })} />
      <Slider label="Whites" value={node.whites} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ whites: v })} />
      <Slider label="Blacks" value={node.blacks} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ blacks: v })} />
    </div>
  );
}

function SaturationControls({ node, onChange }: { node: SaturationNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  return (
    <div className={styles.sliders}>
      <Slider label="Saturation" value={node.saturation} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ saturation: v })} />
      <Slider label="Vibrance" value={node.vibrance} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ vibrance: v })} />
    </div>
  );
}

function VignetteControls({ node, onChange }: { node: VignetteNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  return (
    <div className={styles.sliders}>
      <Slider label="Vignette" value={node.vignette} min={0} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ vignette: v })} />
    </div>
  );
}

function CurvesControls({ node, onChange }: { node: CurvesNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const curves: Curves = node.curves;
  const points = curves[channel];
  const isIdentity = isIdentityCurve(points);
  const channels: CurveChannel[] = ['rgb', 'r', 'g', 'b'];

  const handleCurveChange = (ch: CurveChannel, pts: CurvePoint[]) => {
    onChange({ curves: { ...curves, [ch]: pts } });
  };

  const handleResetCurve = (ch: CurveChannel) => {
    onChange({ curves: { ...curves, [ch]: IDENTITY_POINTS } });
  };

  return (
    <div className={styles.curvesSection}>
      <div className={styles.curvesHeader}>
        <div className={styles.channelTabs} role="tablist" aria-label="Curve channel">
          {channels.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={channel === c}
              className={`${styles.channelTab} ${channel === c ? styles.channelTabActive : ''}`}
              style={{ color: CHANNEL_COLORS[c] }}
              onClick={() => setChannel(c)}
            >
              {CHANNEL_LABELS[c]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.textBtn}
          onClick={() => handleResetCurve(channel)}
          disabled={isIdentity}
        >
          Reset
        </button>
      </div>
      <CurveEditor
        points={points}
        color={CHANNEL_COLORS[channel]}
        onChange={(pts) => handleCurveChange(channel, pts)}
      />
    </div>
  );
}

function LevelsControls({ node, onChange }: { node: LevelsNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  const levels: Levels = node.levels;
  return (
    <LevelsEditor
      levels={levels}
      onChange={(newLevels) => onChange({ levels: newLevels })}
      onReset={() => onChange({ levels: IDENTITY_LEVELS })}
    />
  );
}
