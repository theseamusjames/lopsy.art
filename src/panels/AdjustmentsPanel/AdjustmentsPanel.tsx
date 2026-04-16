import { useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { Slider } from '../../components/Slider/Slider';
import { IconButton } from '../../components/IconButton/IconButton';
import { CurveEditor } from '../../components/CurveEditor/CurveEditor';
import { useEditorStore } from '../../app/editor-store';
import { useUIStore } from '../../app/ui-store';
import { DEFAULT_ADJUSTMENTS } from '../../filters/image-adjustments';
import {
  IDENTITY_CURVES,
  IDENTITY_POINTS,
  isIdentityCurve,
  type CurveChannel,
  type CurvePoint,
  type Curves,
} from '../../filters/curves';
import {
  IDENTITY_LEVELS,
  IDENTITY_LEVELS_CHANNEL,
  isIdentityLevelsChannel,
  type Levels,
  type LevelsChannel,
} from '../../filters/levels';
import type { GroupLayer } from '../../types';
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

type ScalarAdjustmentKey =
  | 'exposure' | 'contrast' | 'highlights' | 'shadows'
  | 'whites' | 'blacks' | 'vignette' | 'saturation' | 'vibrance';

interface AdjustmentSliderDef {
  key: ScalarAdjustmentKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

const VALUE_SLIDERS: AdjustmentSliderDef[] = [
  { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.1 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { key: 'whites', label: 'Whites', min: -100, max: 100, step: 1 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100, step: 1 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 100, step: 1 },
];

const COLOR_SLIDERS: AdjustmentSliderDef[] = [
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1 },
];

type TabId = 'values' | 'colors';

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
}

export function AdjustmentsPanel({ showHeader }: AdjustmentsPanelProps = {}) {
  const group = useActiveGroup();
  const setGroupAdjustments = useEditorStore((s) => s.setGroupAdjustments);
  const setGroupAdjustmentsEnabled = useEditorStore((s) => s.setGroupAdjustmentsEnabled);
  const setShowEffectsDrawer = useUIStore((s) => s.setShowEffectsDrawer);
  const [activeTab, setActiveTab] = useState<TabId>('values');

  if (!group) return null;

  const adjustments = group.adjustments ?? DEFAULT_ADJUSTMENTS;
  const adjustmentsEnabled = group.adjustmentsEnabled ?? true;

  const handleChange = (key: ScalarAdjustmentKey, value: number) => {
    setGroupAdjustments(group.id, { ...adjustments, [key]: value });
  };

  const handleReset = () => {
    setGroupAdjustments(group.id, { ...DEFAULT_ADJUSTMENTS });
  };

  const curves: Curves = adjustments.curves ?? IDENTITY_CURVES;
  const handleCurveChange = (channel: CurveChannel, points: CurvePoint[]) => {
    setGroupAdjustments(group.id, {
      ...adjustments,
      curves: { ...curves, [channel]: points },
    });
  };
  const handleResetCurve = (channel: CurveChannel) => {
    setGroupAdjustments(group.id, {
      ...adjustments,
      curves: { ...curves, [channel]: IDENTITY_POINTS },
    });
  };

  const levels: Levels = adjustments.levels ?? IDENTITY_LEVELS;
  const handleLevelsChange = (channel: CurveChannel, next: LevelsChannel) => {
    setGroupAdjustments(group.id, {
      ...adjustments,
      levels: { ...levels, [channel]: next },
    });
  };
  const handleResetLevels = (channel: CurveChannel) => {
    setGroupAdjustments(group.id, {
      ...adjustments,
      levels: { ...levels, [channel]: IDENTITY_LEVELS_CHANNEL },
    });
  };

  const sliders = activeTab === 'values' ? VALUE_SLIDERS : COLOR_SLIDERS;

  return (
    <div className={styles.panel}>
      {showHeader && (
        <div className={styles.header}>
          <span className={styles.headerTitle}>{group.name}</span>
          <IconButton
            icon={<X size={14} />}
            label="Close"
            onClick={() => setShowEffectsDrawer(false)}
          />
        </div>
      )}
      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'values' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('values')}
        >
          Values
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === 'colors' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('colors')}
        >
          Colors
        </button>
      </div>
      <div className={styles.scrollArea}>
        <div className={styles.sliders}>
          {sliders.map((s) => (
            <Slider
              key={s.key}
              label={s.label}
              value={adjustments[s.key]}
              min={s.min}
              max={s.max}
              step={s.step}
              defaultValue={0}
              onChange={(v) => handleChange(s.key, v)}
            />
          ))}
        </div>
        {activeTab === 'colors' && (
          <CurvesSection
            curves={curves}
            onChange={handleCurveChange}
            onReset={handleResetCurve}
          />
        )}
        {activeTab === 'values' && (
          <LevelsSection
            levels={levels}
            onChange={handleLevelsChange}
            onReset={handleResetLevels}
          />
        )}
      </div>
      <div className={styles.footer}>
        <button type="button" className={styles.textBtn} onClick={handleReset}>
          Reset
        </button>
        <button
          type="button"
          className={`${styles.iconBtn} ${!adjustmentsEnabled ? styles.iconBtnOff : ''}`}
          onClick={() => setGroupAdjustmentsEnabled(group.id, !adjustmentsEnabled)}
        >
          {adjustmentsEnabled ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      </div>
    </div>
  );
}

interface LevelsSectionProps {
  levels: Levels;
  onChange: (channel: CurveChannel, next: LevelsChannel) => void;
  onReset: (channel: CurveChannel) => void;
}

function LevelsSection({ levels, onChange, onReset }: LevelsSectionProps) {
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const channels: CurveChannel[] = ['rgb', 'r', 'g', 'b'];
  const current = levels[channel];
  const isIdentity = isIdentityLevelsChannel(current);

  const patch = (fields: Partial<LevelsChannel>) => {
    onChange(channel, { ...current, ...fields });
  };

  // Clamp input-white strictly above input-black as the user drags, so the
  // curve never flips or becomes degenerate.
  const handleInBlack = (v: number) => {
    const next = Math.max(0, Math.min(254, Math.round(v)));
    const clampedWhite = Math.max(current.inWhite, next + 1);
    patch({ inBlack: next, inWhite: clampedWhite });
  };
  const handleInWhite = (v: number) => {
    const next = Math.max(1, Math.min(255, Math.round(v)));
    const clampedBlack = Math.min(current.inBlack, next - 1);
    patch({ inBlack: clampedBlack, inWhite: next });
  };

  return (
    <div className={styles.curvesSection} data-testid="levels-section">
      <div className={styles.curvesHeader}>
        <span className={styles.label}>Levels</span>
        <div className={styles.channelTabs} role="tablist" aria-label="Levels channel">
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
          onClick={() => onReset(channel)}
          disabled={isIdentity}
        >
          Reset
        </button>
      </div>
      <div className={styles.sliders} data-testid="levels-sliders">
        <Slider
          label="Input Black"
          value={current.inBlack}
          min={0}
          max={254}
          step={1}
          defaultValue={0}
          onChange={handleInBlack}
        />
        <Slider
          label="Gamma"
          value={current.gamma}
          min={0.1}
          max={10}
          step={0.01}
          defaultValue={1}
          onChange={(v) => patch({ gamma: v })}
        />
        <Slider
          label="Input White"
          value={current.inWhite}
          min={1}
          max={255}
          step={1}
          defaultValue={255}
          onChange={handleInWhite}
        />
        <Slider
          label="Output Black"
          value={current.outBlack}
          min={0}
          max={255}
          step={1}
          defaultValue={0}
          onChange={(v) => patch({ outBlack: Math.round(v) })}
        />
        <Slider
          label="Output White"
          value={current.outWhite}
          min={0}
          max={255}
          step={1}
          defaultValue={255}
          onChange={(v) => patch({ outWhite: Math.round(v) })}
        />
      </div>
    </div>
  );
}

interface CurvesSectionProps {
  curves: Curves;
  onChange: (channel: CurveChannel, points: CurvePoint[]) => void;
  onReset: (channel: CurveChannel) => void;
}

function CurvesSection({ curves, onChange, onReset }: CurvesSectionProps) {
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const channels: CurveChannel[] = ['rgb', 'r', 'g', 'b'];
  const points = curves[channel];
  const isIdentity = isIdentityCurve(points);

  return (
    <div className={styles.curvesSection}>
      <div className={styles.curvesHeader}>
        <span className={styles.label}>Curves</span>
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
          onClick={() => onReset(channel)}
          disabled={isIdentity}
        >
          Reset
        </button>
      </div>
      <CurveEditor
        points={points}
        color={CHANNEL_COLORS[channel]}
        onChange={(pts) => onChange(channel, pts)}
      />
    </div>
  );
}
