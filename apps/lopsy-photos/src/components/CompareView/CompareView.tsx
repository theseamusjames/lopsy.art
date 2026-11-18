import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { useLibraryView } from '../../app/hooks';
import { useUi } from '../../app/store';
import { backOut, setLabel, setRating } from '../../app/commands';
import { orderedSelection } from '../../library/selection';
import { Button } from '../Button/Button';
import { LabelPicker } from '../LabelPicker/LabelPicker';
import { Preview, type ZoomPoint } from '../Preview/Preview';
import { Stars } from '../Stars/Stars';
import styles from './CompareView.module.css';

export const MAX_COMPARE = 4;

interface CompareViewProps {
  orderedIds: readonly AssetId[];
}

/** Two to four selected photos side by side. Clicking one makes it the one the keys act on. */
export function CompareView({ orderedIds }: CompareViewProps) {
  const view = useLibraryView();
  const selection = useUi((s) => s.selection);
  const setSelection = useUi((s) => s.setSelection);
  const ids = orderedSelection(selection, orderedIds).slice(0, MAX_COMPARE);
  const extra = selection.ids.size - ids.length;
  // One zoom for all panes, so the same spot is compared in each.
  const [zoom, setZoom] = useState<ZoomPoint | null>(null);

  return (
    <div className={styles.view}>
      <div className={styles.top}>
        <Button variant="ghost" size="sm" onClick={backOut}>
          <ArrowLeft size={14} />
          Back to the grid
        </Button>
        <span className={styles.hint}>
          Click a photo to look closer at the same spot in all of them; the keys mark the one outlined.
          {extra > 0 && ` ${extra} more selected photo${extra === 1 ? ' is' : 's are'} not shown.`}
        </span>
      </div>
      <div className={styles.panes} data-count={ids.length}>
        {ids.map((id) => {
          const asset = view.assets.get(id);
          if (!asset) return null;
          return (
            <div
              key={id}
              className={styles.pane}
              data-focused={selection.focus === id}
              onClick={() => setSelection({ ...selection, focus: id })}
            >
              <div className={styles.image}>
                <Preview assetId={id} zoom={zoom} onZoom={setZoom} />
              </div>
              <div className={styles.caption}>
                <span className={styles.name}>{asset.fileName}</span>
                <Stars rating={asset.rating} size={14} onChange={(r) => setRating(r, orderedIds, [id])} />
                <LabelPicker value={asset.label} onChange={(l) => setLabel(l, orderedIds, [id])} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
