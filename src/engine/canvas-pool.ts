export interface PooledCanvas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  release: () => void;
}

interface PoolEntry {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  inUse: boolean;
}

export interface CanvasPoolStats {
  total: number;
  inUse: number;
  available: number;
}

export class CanvasPool {
  private pool: PoolEntry[] = [];

  acquire(width: number, height: number): PooledCanvas {
    const entry = this.pool.find((e) => !e.inUse);

    if (entry) {
      entry.inUse = true;
      if (entry.canvas.width !== width || entry.canvas.height !== height) {
        entry.canvas.width = width;
        entry.canvas.height = height;
      } else {
        entry.ctx.clearRect(0, 0, width, height);
      }
      entry.ctx.globalCompositeOperation = 'source-over';
      entry.ctx.filter = 'none';
      entry.ctx.globalAlpha = 1;
      entry.ctx.setTransform(1, 0, 0, 1, 0, 0);
      return {
        canvas: entry.canvas,
        ctx: entry.ctx,
        release: () => this.release(entry),
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2d context from canvas');
    }

    const newEntry: PoolEntry = { canvas, ctx, inUse: true };
    this.pool.push(newEntry);

    return {
      canvas: newEntry.canvas,
      ctx: newEntry.ctx,
      release: () => this.release(newEntry),
    };
  }

  private release(entry: PoolEntry): void {
    entry.inUse = false;
    entry.ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
  }

  clear(): void {
    this.pool.length = 0;
  }

  get stats(): CanvasPoolStats {
    const total = this.pool.length;
    const inUse = this.pool.filter((e) => e.inUse).length;
    return { total, inUse, available: total - inUse };
  }
}

export const canvasPool = new CanvasPool();
