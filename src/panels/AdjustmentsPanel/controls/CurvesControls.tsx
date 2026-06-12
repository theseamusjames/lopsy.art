import { useState } from 'react';
import { CurveEditor } from '../../../components/CurveEditor/CurveEditor';
import { useGroupHistogram } from '../useGroupHistogram';
import {
  IDENTITY_POINTS,
  isIdentityCurve,
  type CurveChannel,
  type CurvePoint,
  type Curves,
} from '../../../filters/curves';
import type { CurvesNode } from '../../../types/adjustment-nodes';
import type { NodeControlProps } from './types';
import styles from '../AdjustmentsPanel.module.css';

const CHANNEL_COLORS: Record<CurveChannel, string> = {
  rgb: '#e0e0e0',
  r: '#e0e0e0',
  g: '#e0e0e0',
  b: '#e0e0e0',
};

const CHANNEL_TAB_COLORS: Record<CurveChannel, string> = {
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

export function CurvesControls({ node, onChange }: NodeControlProps<CurvesNode>) {
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const histogram = useGroupHistogram(false);
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
              style={{ '--channel-color': CHANNEL_TAB_COLORS[c] } as React.CSSProperties}
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
        histogram={histogram}
        channel={channel}
      />
    </div>
  );
}
