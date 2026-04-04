import type { StoredPath } from '../../types/paths';
import { useEditorStore } from '../../app/editor-store';
import { contextOptions } from '../../engine/color-space';

export function pathToSelection(path: StoredPath): void {
  const editorState = useEditorStore.getState();
  const { width: docW, height: docH } = editorState.document;
  if (path.anchors.length < 2) return;

  const canvas = document.createElement('canvas');
  canvas.width = docW;
  canvas.height = docH;
  const ctx = canvas.getContext('2d', contextOptions);
  if (!ctx) return;

  ctx.beginPath();
  for (let i = 0; i < path.anchors.length; i++) {
    const anchor = path.anchors[i];
    if (!anchor) continue;
    if (i === 0) {
      ctx.moveTo(anchor.point.x, anchor.point.y);
    } else {
      const prev = path.anchors[i - 1];
      if (!prev) continue;
      const cp1 = prev.handleOut ?? prev.point;
      const cp2 = anchor.handleIn ?? anchor.point;
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, anchor.point.x, anchor.point.y);
    }
  }

  if (path.closed && path.anchors.length >= 2) {
    const last = path.anchors[path.anchors.length - 1];
    const first = path.anchors[0];
    if (last && first) {
      const cp1 = last.handleOut ?? last.point;
      const cp2 = first.handleIn ?? first.point;
      ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, first.point.x, first.point.y);
    }
  }

  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  const imageData = ctx.getImageData(0, 0, docW, docH);
  const mask = new Uint8ClampedArray(docW * docH);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = imageData.data[i * 4 + 3] ?? 0;
  }

  editorState.setSelection(
    { x: 0, y: 0, width: docW, height: docH },
    mask,
    docW,
    docH,
  );
}
