import { useEditorStore } from '../../editor-store';
import { useUIStore } from '../../ui-store';
import { canMergeDown } from '../../store/actions/merge-down';
import type { MenuDef } from './types';
import { isPhotosEnabled } from '../../../io/photos-handoff/photos-url';
import { gradeLayerInPhotos } from '../../../io/photos-handoff/grade-layer';
import { canGradeLayer } from '../../../io/photos-handoff/grade-checks';

export function createLayerMenu(): MenuDef {
  const doc = useEditorStore.getState().document;
  const disableMergeDown = !canMergeDown(doc);
  const activeLayer = doc.layers.find((l) => l.id === doc.activeLayerId);
  return {
    label: 'Layer',
    items: [
      { label: 'New Layer', shortcut: '\u21E7\u2318N', action: () => useEditorStore.getState().addLayer() },
      { label: 'Duplicate Layer', shortcut: '\u2318J', action: () => useEditorStore.getState().duplicateLayer() },
      { label: 'Group Layers', shortcut: '\u2318G', action: () => useEditorStore.getState().groupSelectedLayers() },
      { separator: true, label: '' },
      {
        label: 'Adjustment Layer\u2026',
        action: () => {
          const rootGroupId = useEditorStore.getState().document.rootGroupId;
          if (rootGroupId) useEditorStore.getState().setActiveLayer(rootGroupId);
          useUIStore.getState().setShowEffectsDrawer(true);
          useUIStore.getState().openModal({ kind: 'adjustmentLayerInfo' });
        },
      },
      { separator: true, label: '' },
      {
        label: 'Merge Down',
        shortcut: '\u2318E',
        action: () => useEditorStore.getState().mergeDown(),
        disabled: disableMergeDown,
      },
      { label: 'Flatten Image', action: () => void useEditorStore.getState().flattenImage() },
      // Only builds that ship Photonamous (VITE_PHOTOS_URL) offer the grade.
      ...(isPhotosEnabled()
        ? [
            { separator: true, label: '' },
            {
              label: 'Grade in Photonamous\u2026',
              action: () => void gradeLayerInPhotos(),
              disabled: !canGradeLayer(activeLayer),
            },
          ]
        : []),
    ],
  };
}
