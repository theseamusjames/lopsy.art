import { describe, it, expect } from 'vitest';
import { Viewport } from './viewport';

describe('Viewport', () => {
  it('initializes with defaults', () => {
    const vp = new Viewport(800, 600);
    expect(vp.zoom).toBe(1);
    expect(vp.panX).toBe(0);
    expect(vp.panY).toBe(0);
    expect(vp.width).toBe(800);
    expect(vp.height).toBe(600);
  });

  describe('coordinate transforms', () => {
    it('round-trips screenToCanvas and canvasToScreen at zoom=1 pan=0', () => {
      const vp = new Viewport(800, 600);
      const screen = { x: 100, y: 200 };
      const canvas = vp.screenToCanvas(screen);
      const backToScreen = vp.canvasToScreen(canvas);
      expect(backToScreen.x).toBeCloseTo(screen.x);
      expect(backToScreen.y).toBeCloseTo(screen.y);
    });

    it('round-trips at non-default zoom and pan', () => {
      const vp = new Viewport(800, 600);
      vp.zoomTo(2);
      vp.pan(50, -30);
      const screen = { x: 300, y: 250 };
      const canvas = vp.screenToCanvas(screen);
      const backToScreen = vp.canvasToScreen(canvas);
      expect(backToScreen.x).toBeCloseTo(screen.x);
      expect(backToScreen.y).toBeCloseTo(screen.y);
    });

    it('screenToCanvas accounts for zoom', () => {
      const vp = new Viewport(800, 600);
      vp.zoomTo(2, { x: 0, y: 0 });
      const canvas = vp.screenToCanvas({ x: 200, y: 100 });
      expect(canvas.x).toBeCloseTo(100);
      expect(canvas.y).toBeCloseTo(50);
    });
  });

  describe('zoom', () => {
    it('clamps zoom to minimum', () => {
      const vp = new Viewport(800, 600);
      vp.zoomTo(0.001);
      expect(vp.zoom).toBe(0.01);
    });

    it('clamps zoom to maximum', () => {
      const vp = new Viewport(800, 600);
      vp.zoomTo(100);
      expect(vp.zoom).toBe(64);
    });

    it('zoomTo preserves point under cursor', () => {
      const vp = new Viewport(800, 600);
      const center = { x: 200, y: 150 };
      const canvasBefore = vp.screenToCanvas(center);
      vp.zoomTo(3, center);
      const canvasAfter = vp.screenToCanvas(center);
      expect(canvasAfter.x).toBeCloseTo(canvasBefore.x);
      expect(canvasAfter.y).toBeCloseTo(canvasBefore.y);
    });

    it('zoomBy multiplies current zoom', () => {
      const vp = new Viewport(800, 600);
      const center = { x: 400, y: 300 };
      vp.zoomTo(2, center);
      const canvasBefore = vp.screenToCanvas(center);
      vp.zoomBy(1.5, center);
      expect(vp.zoom).toBeCloseTo(3);
      const canvasAfter = vp.screenToCanvas(center);
      expect(canvasAfter.x).toBeCloseTo(canvasBefore.x);
      expect(canvasAfter.y).toBeCloseTo(canvasBefore.y);
    });
  });

  describe('pan', () => {
    it('shifts pan offsets', () => {
      const vp = new Viewport(800, 600);
      vp.pan(100, -50);
      expect(vp.panX).toBe(100);
      expect(vp.panY).toBe(-50);
    });

    it('accumulates multiple pans', () => {
      const vp = new Viewport(800, 600);
      vp.pan(10, 20);
      vp.pan(30, 40);
      expect(vp.panX).toBe(40);
      expect(vp.panY).toBe(60);
    });
  });

  describe('fitToRect', () => {
    it('fits a rect to the viewport', () => {
      const vp = new Viewport(800, 600);
      vp.fitToRect({ x: 0, y: 0, width: 1600, height: 1200 });
      expect(vp.zoom).toBeCloseTo(0.5);
    });

    it('fits with padding', () => {
      const vp = new Viewport(800, 600);
      vp.fitToRect({ x: 0, y: 0, width: 800, height: 600 }, 100);
      // Available space: 600x400, rect: 800x600
      // scale = min(600/800, 400/600) = min(0.75, 0.667) = 0.667
      expect(vp.zoom).toBeCloseTo(2 / 3, 2);
    });

    it('centers the rect in the viewport', () => {
      const vp = new Viewport(800, 600);
      vp.fitToRect({ x: 100, y: 100, width: 400, height: 300 });
      // zoom = min(800/400, 600/300) = 2, but clamped to 2
      // rect center: (300, 250)
      // panX = 400 - 300*2 = -200
      // panY = 300 - 250*2 = -200
      const center = vp.canvasToScreen({ x: 300, y: 250 });
      expect(center.x).toBeCloseTo(400);
      expect(center.y).toBeCloseTo(300);
    });
  });

  describe('reset', () => {
    it('restores defaults', () => {
      const vp = new Viewport(800, 600);
      vp.zoomTo(3);
      vp.pan(100, 200);
      vp.reset();
      expect(vp.zoom).toBe(1);
      expect(vp.panX).toBe(0);
      expect(vp.panY).toBe(0);
    });
  });
});
