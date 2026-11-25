import { useState } from 'react';
import type { CurveChannel, CurvePoint } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import { CurveEditor } from '../../components/CurveEditor/CurveEditor';
import { CURVE_CHANNEL_DEFS } from '../edit-controls';
import { useTabs } from '../tabs';
import styles from './CurvesControls.module.css';

export interface CurvesControlsProps {
  /** The curves shown: the photo's, or a mask's own. */
  readonly curves: Readonly<Record<CurveChannel, readonly CurvePoint[]>>;
  /** The recipe leaf that holds a channel's curve ('curves.red', or a mask's). */
  readonly pathOf: (channel: CurveChannel) => string;
  /** How the history names a change to a channel, given the channel's name ("Curves: Red"). */
  readonly historyLabel: (channel: string) => string;
  readonly isDisabled: boolean;
  /** Live, while a point moves. */
  readonly onDraft: (changes: Record<string, Json>) => void;
  readonly onCommit: (changes: Record<string, Json>, label: string) => void;
}

function asJson(points: readonly CurvePoint[]): Json {
  return points.map((p) => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 }));
}

/** A point curve per channel under tabs, one history step per release: the body of Curves in the Edit panel, and of a mask's own curves. */
export function CurvesControls({ curves, pathOf, historyLabel, isDisabled, onDraft, onCommit }: CurvesControlsProps) {
  const [channel, setChannel] = useState<CurveChannel>('luminance');
  const def = CURVE_CHANNEL_DEFS.find((c) => c.id === channel) ?? CURVE_CHANNEL_DEFS[0];
  const { tabProps, panelProps } = useTabs(
    CURVE_CHANNEL_DEFS.map((c) => c.id),
    channel,
    setChannel,
  );
  if (!def) return null;
  const path = pathOf(def.id);

  return (
    <>
      <div className={styles.tabs} role="tablist" aria-label="Curve channel">
        {CURVE_CHANNEL_DEFS.map((c) => (
          <button key={c.id} type="button" className={styles.tab} {...tabProps(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div {...panelProps}>
        <CurveEditor
          label={`${def.label} curve`}
          points={curves[def.id]}
          color={def.color}
          isDisabled={isDisabled}
          onChange={(points) => onDraft({ [path]: asJson(points) })}
          onCommit={(points) => onCommit({ [path]: asJson(points) }, historyLabel(def.label))}
        />
      </div>
    </>
  );
}
