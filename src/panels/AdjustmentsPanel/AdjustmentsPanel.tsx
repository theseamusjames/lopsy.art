import { useCallback, useState } from 'react';
import { Eye, EyeOff, X, ChevronDown, ChevronRight, GripVertical, Trash2, Plus } from 'lucide-react';
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
  TemperatureTintNode,
  VignetteNode,
  CurvesNode,
  LevelsNode,
  HueSaturationNode,
  ColorBalanceNode,
  PhotoFilterNode,
  BlackWhiteNode,
  ChannelMixerNode,
  GradientMapNode,
} from '../../types/adjustment-nodes';
import {
  ADJUSTMENT_NODE_LABELS,
} from '../../filters/adjustment-node-utils';
import type { GradientStop } from '../../tools/gradient/gradient';
import type { Color } from '../../types';
import { GradientEditor } from '../../components/GradientEditor/GradientEditor';
import { ColorPicker } from '../../components/ColorPicker/ColorPicker';
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
  'temperature-tint',
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
  switch (node.type) {
    case 'exposure':
      return <ExposureControls node={node} onChange={onChange} />;
    case 'contrast':
      return <ContrastControls node={node} onChange={onChange} />;
    case 'highlights-shadows':
      return <HighlightsShadowsControls node={node} onChange={onChange} />;
    case 'saturation':
      return <SaturationControls node={node} onChange={onChange} />;
    case 'temperature-tint':
      return <TemperatureTintControls node={node} onChange={onChange} />;
    case 'vignette':
      return <VignetteControls node={node} onChange={onChange} />;
    case 'curves':
      return <CurvesControls node={node} onChange={onChange} />;
    case 'levels':
      return <LevelsControls node={node} onChange={onChange} />;
    case 'hue-saturation':
      return <HueSaturationControls node={node} onChange={onChange} />;
    case 'color-balance':
      return <ColorBalanceControls node={node} onChange={onChange} />;
    case 'photo-filter':
      return <PhotoFilterControls node={node} onChange={onChange} />;
    case 'black-white':
      return <BlackWhiteControls node={node} onChange={onChange} />;
    case 'channel-mixer':
      return <ChannelMixerControls node={node} onChange={onChange} />;
    case 'gradient-map':
      return <GradientMapControls node={node} onChange={onChange} />;
    case 'invert':
      return <p className={styles.invertNote}>No parameters — the layer is inverted when enabled.</p>;
    default:
      return null;
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

function TemperatureTintControls({ node, onChange }: { node: TemperatureTintNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  return (
    <div className={styles.sliders}>
      <Slider label="Temperature" value={node.temperature} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ temperature: v })} />
      <Slider label="Tint" value={node.tint} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ tint: v })} />
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

function HueSaturationControls({ node, onChange }: { node: HueSaturationNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  return (
    <div className={styles.sliders}>
      <Slider label="Hue" value={node.hue} min={-180} max={180} step={1} defaultValue={0}
        onChange={(v) => onChange({ hue: v })} />
      <Slider label="Saturation" value={node.saturation} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ saturation: v })} />
      <Slider label="Lightness" value={node.lightness} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ lightness: v })} />
    </div>
  );
}

function ColorBalanceControls({ node, onChange }: { node: ColorBalanceNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  const [toneRange, setToneRange] = useState<'shadows' | 'midtones' | 'highlights'>('midtones');
  const current = node[`${toneRange}CMY` as keyof ColorBalanceNode] as [number, number, number];
  return (
    <div className={styles.sliders}>
      <div className={styles.channelTabs} role="tablist" aria-label="Tone range">
        {(['shadows', 'midtones', 'highlights'] as const).map((range) => (
          <button key={range} type="button" role="tab"
            aria-selected={toneRange === range}
            className={`${styles.channelTab} ${toneRange === range ? styles.channelTabActive : ''}`}
            onClick={() => setToneRange(range)}
          >
            {range.charAt(0).toUpperCase() + range.slice(1)}
          </button>
        ))}
      </div>
      <Slider label="Cyan — Red" value={current[0]} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ [`${toneRange}CMY`]: [v, current[1], current[2]] })} />
      <Slider label="Magenta — Green" value={current[1]} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ [`${toneRange}CMY`]: [current[0], v, current[2]] })} />
      <Slider label="Yellow — Blue" value={current[2]} min={-100} max={100} step={1} defaultValue={0}
        onChange={(v) => onChange({ [`${toneRange}CMY`]: [current[0], current[1], v] })} />
    </div>
  );
}

function PhotoFilterControls({ node, onChange }: { node: PhotoFilterNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  const toHex = (c: { r: number; g: number; b: number }) =>
    '#' + [c.r, c.g, c.b].map((v) => v.toString(16).padStart(2, '0')).join('');
  const fromHex = (hex: string): { r: number; g: number; b: number } => ({
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  });
  return (
    <div className={styles.sliders}>
      <div className={styles.colorRow}>
        <label className={styles.colorLabel}>Filter color</label>
        <input
          type="color"
          className={styles.colorSwatch}
          value={toHex(node.color)}
          onChange={(e) => onChange({ color: fromHex(e.target.value) })}
          aria-label="Filter color"
        />
      </div>
      <Slider label="Density" value={node.density} min={0} max={100} step={1} defaultValue={25}
        onChange={(v) => onChange({ density: v })} />
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={node.preserveLuminosity}
          onChange={(e) => onChange({ preserveLuminosity: e.target.checked })} />
        <span>Preserve Luminosity</span>
      </label>
    </div>
  );
}

function BlackWhiteControls({ node, onChange }: { node: BlackWhiteNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  return (
    <div className={styles.sliders}>
      <Slider label="Reds" value={node.reds} min={-200} max={300} step={1} defaultValue={40}
        onChange={(v) => onChange({ reds: v })} />
      <Slider label="Yellows" value={node.yellows} min={-200} max={300} step={1} defaultValue={60}
        onChange={(v) => onChange({ yellows: v })} />
      <Slider label="Greens" value={node.greens} min={-200} max={300} step={1} defaultValue={40}
        onChange={(v) => onChange({ greens: v })} />
      <Slider label="Cyans" value={node.cyans} min={-200} max={300} step={1} defaultValue={60}
        onChange={(v) => onChange({ cyans: v })} />
      <Slider label="Blues" value={node.blues} min={-200} max={300} step={1} defaultValue={20}
        onChange={(v) => onChange({ blues: v })} />
      <Slider label="Magentas" value={node.magentas} min={-200} max={300} step={1} defaultValue={80}
        onChange={(v) => onChange({ magentas: v })} />
    </div>
  );
}

function ChannelMixerControls({ node, onChange }: { node: ChannelMixerNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  return (
    <div className={styles.sliders}>
      <div className={styles.channelTabs} role="tablist" aria-label="Output channel">
        {(['red', 'green', 'blue'] as const).map((ch) => (
          <button key={ch} type="button" role="tab"
            aria-selected={node.outputChannel === ch}
            className={`${styles.channelTab} ${node.outputChannel === ch ? styles.channelTabActive : ''}`}
            style={{ color: ch === 'red' ? '#ff5e5e' : ch === 'green' ? '#5eff7e' : '#5e9eff' }}
            onClick={() => onChange({ outputChannel: ch })}
          >
            {ch.charAt(0).toUpperCase()}
          </button>
        ))}
      </div>
      <Slider label="Red" value={node.red} min={-200} max={200} step={1} defaultValue={node.outputChannel === 'red' ? 100 : 0}
        onChange={(v) => onChange({ red: v })} />
      <Slider label="Green" value={node.green} min={-200} max={200} step={1} defaultValue={node.outputChannel === 'green' ? 100 : 0}
        onChange={(v) => onChange({ green: v })} />
      <Slider label="Blue" value={node.blue} min={-200} max={200} step={1} defaultValue={node.outputChannel === 'blue' ? 100 : 0}
        onChange={(v) => onChange({ blue: v })} />
      <Slider label="Constant" value={node.constant} min={-200} max={200} step={1} defaultValue={0}
        onChange={(v) => onChange({ constant: v })} />
    </div>
  );
}

function GradientMapControls({ node, onChange }: { node: GradientMapNode; onChange: (p: Partial<AdjustmentNode>) => void }) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const sorted = [...node.stops].sort((a, b) => a.position - b.position);
  const selectedStop = sorted[selectedIndex];

  const handleStopsChange = useCallback((stops: readonly GradientStop[]) => {
    onChange({ stops });
  }, [onChange]);

  const handleColorChange = useCallback((color: Color) => {
    const newStops = sorted.map((stop, i) =>
      i === selectedIndex ? { ...stop, color } : stop,
    );
    onChange({ stops: newStops });
  }, [sorted, selectedIndex, onChange]);

  const handleDelete = useCallback(() => {
    if (node.stops.length <= 2) return;
    const newStops = sorted.filter((_, i) => i !== selectedIndex);
    onChange({ stops: newStops });
    setSelectedIndex(Math.min(selectedIndex, newStops.length - 1));
  }, [node.stops.length, sorted, selectedIndex, onChange]);

  return (
    <div className={styles.gradientMapSection}>
      <GradientEditor
        stops={sorted}
        selectedIndex={selectedIndex}
        onStopsChange={handleStopsChange}
        onSelectStop={setSelectedIndex}
      />
      <div className={styles.gradientStopInfo}>
        {selectedStop && (
          <>
            <div
              className={styles.stopColorPreview}
              style={{ backgroundColor: `rgb(${selectedStop.color.r},${selectedStop.color.g},${selectedStop.color.b})` }}
            />
            <span>Stop {selectedIndex + 1} of {sorted.length}</span>
            <span>Position: {Math.round(selectedStop.position * 100)}%</span>
            <IconButton
              icon={<Trash2 size={12} />}
              label="Delete stop"
              onClick={handleDelete}
              disabled={node.stops.length <= 2}
            />
          </>
        )}
      </div>
      {selectedStop && (
        <ColorPicker color={selectedStop.color} onChange={handleColorChange} />
      )}
    </div>
  );
}
