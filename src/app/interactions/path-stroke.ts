import { PixelBuffer } from '../../engine/pixel-data';
import { useUIStore } from '../ui-store';
import { useEditorStore } from '../editor-store';
import { useToolSettingsStore } from '../tool-settings-store';
import { rasterizePath } from '../../tools/path/path';
import type { PathAnchor } from '../ui-store';

export function rasterizePathToLayer(
  anchors: PathAnchor[],
  closed: boolean,
  layerId: string,
  editorState: ReturnType<typeof useEditorStore.getState>,
): void {
  editorState.pushHistory();
  const imageData = editorState.getOrCreateLayerPixelData(layerId);
  const buf = PixelBuffer.fromImageData(imageData);
  const color = useUIStore.getState().foregroundColor;
  useUIStore.getState().addRecentColor(color);
  const strokeWidth = useToolSettingsStore.getState().pathStrokeWidth;

  rasterizePath(buf, anchors, closed, color, strokeWidth);

  editorState.updateLayerPixelData(layerId, buf.toImageData());
  useUIStore.getState().clearPath();
}

export function strokeCurrentPath(): void {
  const uiState = useUIStore.getState();
  const editorState = useEditorStore.getState();
  const anchors = uiState.pathAnchors;
  const activeId = editorState.document.activeLayerId;
  if (anchors.length < 2 || !activeId) {
    uiState.clearPath();
    return;
  }
  rasterizePathToLayer(anchors, uiState.pathClosed, activeId, editorState);
}
