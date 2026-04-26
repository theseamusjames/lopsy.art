import { useEditorStore } from '../../editor-store';
import { IconButton } from '../../../components/IconButton/IconButton';
import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  RotateCw,
  RotateCcw,
} from 'lucide-react';
import type { AlignEdge } from '../../../tools/move/move';
import { rotateActiveLayer } from '../../MenuBar/menus/image-menu';
import { TransformControls, rotateSelection } from './TransformControls';
import { MeshWarpControls } from './MeshWarpControls';
import styles from '../OptionsBar.module.css';

export function MoveOptions() {
  const alignLayer = useEditorStore((s) => s.alignLayer);
  const selectionActive = useEditorStore((s) => s.selection.active);

  const handleRotate = (dir: 'cw' | 'ccw') => {
    if (selectionActive) {
      rotateSelection(dir);
    } else {
      rotateActiveLayer(dir);
    }
  };

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
      <div className={styles.separator} />
      <div className={styles.alignGroup}>
        <IconButton
          icon={<RotateCcw size={16} />}
          label="Rotate 90° CCW"
          onClick={() => handleRotate('ccw')}
        />
        <IconButton
          icon={<RotateCw size={16} />}
          label="Rotate 90° CW"
          onClick={() => handleRotate('cw')}
        />
      </div>
      <TransformControls />
      <div className={styles.separator} />
      <MeshWarpControls />
    </>
  );
}
