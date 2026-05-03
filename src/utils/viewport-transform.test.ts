import { describe, it, expect } from 'vitest';
import { screenToDoc, type ViewportTransform } from './viewport-transform';

function makeVt(overrides: Partial<ViewportTransform> = {}): ViewportTransform {
  return {
    panX: 0,
    panY: 0,
    zoom: 1,
    canvasWidth: 800,
    canvasHeight: 600,
    docWidth: 400,
    docHeight: 300,
    rotation: 0,
    ...overrides,
  };
}

describe('screenToDoc', () => {
  it('maps the viewport center to the document center with no rotation', () => {
    const vt = makeVt();
    // Screen center = (400, 300) = canvas center with pan 0
    const pt = screenToDoc(400, 300, vt);
    expect(pt.x).toBe(200);
    expect(pt.y).toBe(150);
  });

  it('maps the top-left of the document with no rotation and zoom 1', () => {
    const vt = makeVt();
    // Doc top-left is at screen (200, 150): (800-400)/2 = 200, (600-300)/2 = 150
    const pt = screenToDoc(200, 150, vt);
    expect(pt.x).toBe(0);
    expect(pt.y).toBe(0);
  });

  it('accounts for zoom when converting coordinates', () => {
    const vt = makeVt({ zoom: 2 });
    // At zoom 2, viewport center still maps to doc center
    const center = screenToDoc(400, 300, vt);
    expect(center.x).toBe(200);
    expect(center.y).toBe(150);

    // A point 100px right of viewport center = 50px right in doc space
    const rightOfCenter = screenToDoc(500, 300, vt);
    expect(rightOfCenter.x).toBe(250);
    expect(rightOfCenter.y).toBe(150);
  });

  it('accounts for pan when converting coordinates', () => {
    // panX=50 shifts the canvas 50px to the right. The doc center is now at
    // screenX = canvasWidth/2 + panX = 400 + 50 = 450 (not 400).
    const vt = makeVt({ panX: 50, panY: -30 });

    // The shifted screen position that corresponds to doc center:
    const docCenterScreenX = vt.canvasWidth / 2 + vt.panX; // 450
    const docCenterScreenY = vt.canvasHeight / 2 + vt.panY; // 270
    const center = screenToDoc(docCenterScreenX, docCenterScreenY, vt);
    expect(center.x).toBe(200);
    expect(center.y).toBe(150);

    // The viewport center (screen 400, 300) should now map offset from doc center:
    // offsetX = 400 - 50 - 400 = -50, offsetY = 300 - (-30) - 300 = 30
    // docX = -50/1 + 200 = 150, docY = 30/1 + 150 = 180
    const viewportCenter = screenToDoc(400, 300, vt);
    expect(viewportCenter.x).toBe(150);
    expect(viewportCenter.y).toBe(180);
  });

  it('maps viewport center to doc center at any rotation', () => {
    // Rotation should not affect the mapping of the viewport center
    for (const rotation of [0, Math.PI / 6, Math.PI / 4, Math.PI / 2, Math.PI]) {
      const vt = makeVt({ rotation });
      const pt = screenToDoc(400, 300, vt);
      expect(pt.x).toBe(200);
      expect(pt.y).toBe(150);
    }
  });

  it('90° rotation: a point directly right of center maps to directly below center in doc space', () => {
    // With 90° CW CSS rotation applied to the canvas element, a point that
    // appears to the right of the viewport center (in screen space) was
    // originally below the center in document space.
    // rotation = +π/2 (90° CCW visual → CSS rotate(90deg))
    // We use -rotation in un-rotate, so cos(-π/2)=0, sin(-π/2)=-1
    // unrotatedX = 100*0 - 0*(-1) = 0
    // unrotatedY = 100*(-1) + 0*0 = -100
    // docX = 0/1 + 200 = 200, docY = -100/1 + 150 = 50
    const vt = makeVt({ rotation: Math.PI / 2 });
    // 100px right of viewport center in screen space → (500, 300)
    const pt = screenToDoc(500, 300, vt);
    expect(pt.x).toBe(200); // same horizontal doc position as center
    expect(pt.y).toBe(50);  // 100px above center in doc space (y decreases upward)
  });

  it('180° rotation: everything is flipped around doc center', () => {
    const vt = makeVt({ rotation: Math.PI });
    // A point 50px right and 30px down from the viewport center
    // should map to 50px left and 30px up from doc center
    const pt = screenToDoc(450, 330, vt);
    // offsetX=50, offsetY=30 → un-rotate 180°: cos=−1, sin=0 → x=−50, y=−30
    // docX = (−50)/1 + 200 = 150, docY = (−30)/1 + 150 = 120
    expect(pt.x).toBe(150);
    expect(pt.y).toBe(120);
  });

  it('rotation=0 produces the same result as the original implementation', () => {
    const vt = makeVt({ zoom: 1.5, panX: 20, panY: -10 });
    const x = 350;
    const y = 250;
    // Original formula (no rotation):
    const expectedX = Math.round(
      (x - vt.panX - vt.canvasWidth / 2) / vt.zoom + vt.docWidth / 2,
    );
    const expectedY = Math.round(
      (y - vt.panY - vt.canvasHeight / 2) / vt.zoom + vt.docHeight / 2,
    );
    const pt = screenToDoc(x, y, vt);
    expect(pt.x).toBe(expectedX);
    expect(pt.y).toBe(expectedY);
  });
});
