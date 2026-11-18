import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { CurveChannel, CurvePoint, Recipe } from '@lopsy/photos-core/library/recipe';
import type { Json } from '@lopsy/photos-core/library/types';
import { CurveEditor } from '../../components/CurveEditor/CurveEditor';
import { CURVE_CHANNEL_DEFS, curvesResetChanges } from '../edit-controls';
import styles from './CurvesGroup.module.css';

export interface CurvesGroupProps {
  readonly recipe: Recipe;
  readonly isDisabled: boolean;
  /** Live, while a point moves. */
  readonly onDraft: (changes: Record<string, Json>) => void;
  readonly onCommit: (changes: Record<string, Json>, label: string) => void;
}

function asJson(points: readonly CurvePoint[]): Json {
  return points.map((p) => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 }));
}

/** The Curves group: a point curve per channel, one history step per release. */
export function CurvesGroup({ recipe, isDisabled, onDraft, onCommit }: CurvesGroupProps) {
  const [channel, setChannel] = useState<CurveChannel>('luminance');
  const def = CURVE_CHANNEL_DEFS.find((c) => c.id === channel) ?? CURVE_CHANNEL_DEFS[0];
  const resetChanges = curvesResetChanges(recipe);
  const isDefault = Object.keys(resetChanges).length === 0;
  if (!def) return null;
  const path = `curves.${def.id}`;

  return (
    <section className={styles.group} aria-label="Curves">
      <header className={styles.header}>
        <h3 className={styles.title}>Curves</h3>
        <button
          type="button"
          className={styles.reset}
          aria-label="Reset Curves"
          title="Reset Curves"
          disabled={isDisabled || isDefault}
          onClick={() => onCommit(resetChanges, 'Reset Curves')}
        >
          <RotateCcw size={14} aria-hidden />
        </button>
      </header>
      <div className={styles.tabs} role="tablist" aria-label="Curve channel">
        {CURVE_CHANNEL_DEFS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={c.id === channel}
            onClick={() => setChannel(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <CurveEditor
        label={`${def.label} curve`}
        points={recipe.curves[def.id]}
        color={def.color}
        isDisabled={isDisabled}
        onChange={(points) => onDraft({ [path]: asJson(points) })}
        onCommit={(points) => onCommit({ [path]: asJson(points) }, `Curves: ${def.label}`)}
      />
    </section>
  );
}
