import { useEditorStore } from '../../editor-store';
import { commandItem } from './command-item';
import type { MenuDef } from './types';
import { isPhotosEnabled } from '../../../io/photos-handoff/photos-url';
import { gradeLayerInPhotos } from '../../../io/photos-handoff/grade-layer';
import { canGradeLayer } from '../../../io/photos-handoff/grade-checks';

export function createLayerMenu(): MenuDef {
  const doc = useEditorStore.getState().document;
  const activeLayer = doc.layers.find((l) => l.id === doc.activeLayerId);
  return {
    label: 'Layer',
    items: [
      commandItem('New Layer', 'layer.add', undefined, '⇧⌘N'),
      commandItem('Duplicate Layer', 'ui.layer.duplicate', undefined, '⌘J'),
      commandItem('Group Layers', 'layer.group', undefined, '⌘G'),
      { separator: true, label: '' },
      commandItem('Adjustment Layer…', 'ui.layer.adjustment-layer'),
      { separator: true, label: '' },
      commandItem('Merge Down', 'layer.merge-down', undefined, '⌘E'),
      commandItem('Flatten Image', 'layer.flatten'),
      // Only builds that name Photonamous' URL (VITE_PHOTONAMOUS_URL) offer the grade.
      ...(isPhotosEnabled()
        ? [
            { separator: true, label: '' },
            {
              label: 'Grade in Photonamous…',
              action: () => void gradeLayerInPhotos(),
              disabled: !canGradeLayer(activeLayer),
            },
          ]
        : []),
    ],
  };
}
