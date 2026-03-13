import { describe, it, expect } from 'vitest';
import { screenToCanvas, canvasToScreen, screenDeltaToCanvas, getVisibleRegion } from './coordinates';
import type { ViewportState } from '../types';

describe('coordinates', () => {
  const viewport: ViewportState = {
    zoom: 1,
    panX: 0,
    panY: 0,
    width: 800,
    height: 600,
  };

  describe('screenToCanvas', () => {
    it('maps center of screen to canvas origin at zoom 1', () => {
      const result = screenToCanvas(400, 300, viewport);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });

    it('accounts for zoom', () => {
      const zoomed = { ...viewport, zoom: 2 };
      const result = screenToCanvas(400, 300, zoomed);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);

      const result2 = screenToCanvas(402, 300, zoomed);
      expect(result2.x).toBeCloseTo(1); // 2 screen px = 1 canvas px at 2x
    });

    it('accounts for pan', () => {
      const panned = { ...viewport, panX: 100, panY: 50 };
      const result = screenToCanvas(500, 350, panned);
      expect(result.x).toBeCloseTo(0);
      expect(result.y).toBeCloseTo(0);
    });
  });

  describe('canvasToScreen', () => {
    it('maps canvas origin to center of screen', () => {
      const result = canvasToScreen(0, 0, viewport);
      expect(result.x).toBeCloseTo(400);
      expect(result.y).toBeCloseTo(300);
    });

    it('roundtrips with screenToCanvas', () => {
      const screenPt = { x: 123, y: 456 };
      const zoomed = { ...viewport, zoom: 1.5, panX: 30, panY: -20 };
      const canvas = screenToCanvas(screenPt.x, screenPt.y, zoomed);
      const back = canvasToScreen(canvas.x, canvas.y, zoomed);
      expect(back.x).toBeCloseTo(screenPt.x);
      expect(back.y).toBeCloseTo(screenPt.y);
    });
  });

  describe('screenDeltaToCanvas', () => {
    it('divides by zoom', () => {
      const result = screenDeltaToCanvas(10, 20, 2);
      expect(result.x).toBe(5);
      expect(result.y).toBe(10);
    });
  });

  describe('getVisibleRegion', () => {
    it('returns correct visible region', () => {
      const region = getVisibleRegion(viewport);
      expect(region.width).toBeCloseTo(800);
      expect(region.height).toBeCloseTo(600);
    });

    it('visible region shrinks with zoom', () => {
      const zoomed = { ...viewport, zoom: 2 };
      const region = getVisibleRegion(zoomed);
      expect(region.width).toBeCloseTo(400);
      expect(region.height).toBeCloseTo(300);
    });
  });
});
