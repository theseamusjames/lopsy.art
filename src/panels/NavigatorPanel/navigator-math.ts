/**
 * Pure coordinate math for the Navigator minimap.
 * No React, no DOM — fully unit-testable.
 */

export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the viewport indicator rectangle in thumbnail space.
 *
 * The viewport is centred at (panX=0, panY=0) when the document is
 * centred on screen.  panX/panY are pixel offsets from centre, so the
 * visible document region in doc-space is:
 *
 *   left  = docWidth/2  - (viewportWidth/2  + panX) / zoom
 *   top   = docHeight/2 - (viewportHeight/2 + panY) / zoom
 *   right = left + viewportWidth  / zoom
 *   bot   = top  + viewportHeight / zoom
 *
 * We clamp the result so the indicator never escapes the thumbnail.
 */
export function computeViewportRect(
  docWidth: number,
  docHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
  panX: number,
  panY: number,
  thumbnailWidth: number,
  thumbnailHeight: number,
): ViewportRect {
  if (docWidth <= 0 || docHeight <= 0 || thumbnailWidth <= 0 || thumbnailHeight <= 0) {
    return { x: 0, y: 0, width: thumbnailWidth, height: thumbnailHeight };
  }

  const scaleX = thumbnailWidth / docWidth;
  const scaleY = thumbnailHeight / docHeight;

  // Visible doc-space extents
  const visibleW = viewportWidth / zoom;
  const visibleH = viewportHeight / zoom;

  // Doc-space top-left of the visible area
  // Derived from final_blit.glsl: canvasPos = (screenPos - center - u_pan) / zoom + docSize * 0.5
  const docLeft = docWidth / 2 - (viewportWidth / 2 + panX) / zoom;
  const docTop = docHeight / 2 - (viewportHeight / 2 + panY) / zoom;

  // Map to thumbnail space
  const x = docLeft * scaleX;
  const y = docTop * scaleY;
  const width = visibleW * scaleX;
  const height = visibleH * scaleY;

  return { x, y, width, height };
}

/**
 * Convert a click position on the thumbnail to the document-space point
 * that should become the new viewport centre.
 */
export function thumbnailPointToDocPoint(
  thumbX: number,
  thumbY: number,
  docWidth: number,
  docHeight: number,
  thumbnailWidth: number,
  thumbnailHeight: number,
): { docX: number; docY: number } {
  if (thumbnailWidth <= 0 || thumbnailHeight <= 0) {
    return { docX: docWidth / 2, docY: docHeight / 2 };
  }
  const docX = (thumbX / thumbnailWidth) * docWidth;
  const docY = (thumbY / thumbnailHeight) * docHeight;
  return { docX, docY };
}

/**
 * Convert a desired viewport centre (in doc space) to the (panX, panY)
 * values that centre it on screen.
 *
 * Inverse of the rendering transform used by useCanvasRendering:
 *   screenX = (docX - docWidth/2)  * zoom + panX + canvasWidth/2
 * Setting screenX = canvasWidth/2 gives panX = -(docX - docWidth/2) * zoom.
 */
export function docPointToPan(
  docX: number,
  docY: number,
  docWidth: number,
  docHeight: number,
  zoom: number,
): { panX: number; panY: number } {
  const panX = -(docX - docWidth / 2) * zoom;
  const panY = -(docY - docHeight / 2) * zoom;
  return { panX, panY };
}
