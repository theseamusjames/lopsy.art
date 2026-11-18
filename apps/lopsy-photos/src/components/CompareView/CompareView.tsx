import { ArrowLeft } from 'lucide-react';
import type { AssetId } from '@lopsy/photos-core/library/types';
import { useLibraryView } from '../../app/hooks';
import { useUi } from '../../app/store';
import { backOut, setLabel, setRating } from '../../app/commands';
import { orderedSelection } from '../../library/selection';
import { Button } from '../Button/Button';
import { LabelPicker } from '../LabelPicker/LabelPicker';
import { Preview } from '../Preview/Preview';
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

  return (
    <div className={styles.view}>
      <div className={styles.top}>
        <Button variant="ghost" size="sm" onClick={backOut}>
          <ArrowLeft size={14} />
          Back to the grid
        </Button>
        <span className={styles.hint}>
          Click a photo to mark it with the keys.
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
                <Preview assetId={id} />
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
