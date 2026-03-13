// @vitest-environment jsdom
import '../test/canvas-mock';
import { describe, it, expect, beforeEach } from 'vitest';
import { CanvasPool } from './canvas-pool';

describe('CanvasPool', () => {
  let pool: CanvasPool;

  beforeEach(() => {
    pool = new CanvasPool();
  });

  it('acquires a canvas with correct dimensions', () => {
    const { canvas, release } = pool.acquire(100, 200);
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(200);
    release();
  });

  it('tracks stats correctly', () => {
    expect(pool.stats).toEqual({ total: 0, inUse: 0, available: 0 });
    const a = pool.acquire(10, 10);
    expect(pool.stats).toEqual({ total: 1, inUse: 1, available: 0 });
    const b = pool.acquire(10, 10);
    expect(pool.stats).toEqual({ total: 2, inUse: 2, available: 0 });
    a.release();
    expect(pool.stats).toEqual({ total: 2, inUse: 1, available: 1 });
    b.release();
    expect(pool.stats).toEqual({ total: 2, inUse: 0, available: 2 });
  });

  it('reuses released canvases', () => {
    const a = pool.acquire(10, 10);
    const firstCanvas = a.canvas;
    a.release();
    const b = pool.acquire(10, 10);
    expect(b.canvas).toBe(firstCanvas);
    b.release();
  });

  it('returns different canvases for concurrent acquires', () => {
    const a = pool.acquire(10, 10);
    const b = pool.acquire(10, 10);
    expect(a.canvas).not.toBe(b.canvas);
    a.release();
    b.release();
  });

  it('resizes reused canvases to match requested dimensions', () => {
    const a = pool.acquire(10, 10);
    a.release();
    const b = pool.acquire(50, 30);
    expect(b.canvas.width).toBe(50);
    expect(b.canvas.height).toBe(30);
    b.release();
  });

  it('clears pool on clear()', () => {
    pool.acquire(10, 10);
    pool.acquire(10, 10);
    pool.clear();
    expect(pool.stats.total).toBe(0);
  });
});
