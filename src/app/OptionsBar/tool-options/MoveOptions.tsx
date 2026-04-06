import { useEditorStore } from '../../editor-store';
import { IconButton } from '../../../components/IconButton/IconButton';
import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from 'lucide-react';
import type { AlignEdge } from '../../../tools/move/move';
import { TransformControls } from './TransformControls';
import styles from '../OptionsBar.module.css';

export function MoveOptions() {
  const alignLayer = useEditorStore((s) => s.alignLayer);

  return (
    <>
      <div className={styles.alignGroup}>
        {([
          ['left', AlignHorizontalJustifyStart, 'Align left'],
          ['center-h', AlignHorizontalJustifyCenter, 'Align center horizontally'],
          ['right', AlignHorizontalJustifyEnd, 'Align right'],
          ['top', AlignVerticalJustifyStart, 'Align top'],
          ['center-v', AlignVerticalJustifyCenter, 'Align center vertically'],
          ['bottom', AlignVerticalJustifyEnd, 'Align bottom'],
        ] as const).map(([edge, Icon, label]) => (
          <IconButton
            key={edge}
            icon={<Icon size={16} />}
            label={label}
            onClick={() => alignLayer(edge as AlignEdge)}
          />
        ))}
      </div>
      <TransformControls />
    </>
  );
}
