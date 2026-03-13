import { PixelBuffer } from '../engine/pixel-data';

interface PendingFilter {
  resolve: (buf: PixelBuffer) => void;
  reject: (err: Error) => void;
}

interface FilterResult {
  id: string;
  width: number;
  height: number;
  data: ArrayBuffer;
}

export interface FilterRunnerOptions {
  signal?: AbortSignal;
}

export class FilterRunner {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingFilter>();

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./filter-worker.ts', import.meta.url),
        { type: 'module' },
      );
      this.worker.onmessage = (e: MessageEvent<FilterResult>) => {
        const { id, width, height, data } = e.data;
        const entry = this.pending.get(id);
        if (entry) {
          this.pending.delete(id);
          const pixelData = new Uint8ClampedArray(data);
          entry.resolve(PixelBuffer.fromData(pixelData, width, height));
        }
      };
      this.worker.onerror = (e: ErrorEvent) => {
        for (const [, entry] of this.pending) {
          entry.reject(new Error(e.message));
        }
        this.pending.clear();
      };
    }
    return this.worker;
  }

  async runFilter(
    type: string,
    buf: PixelBuffer,
    params: Record<string, unknown>,
    options?: FilterRunnerOptions,
  ): Promise<PixelBuffer> {
    const id = crypto.randomUUID();
    const data = buf.rawData.buffer.slice(0);

    return new Promise<PixelBuffer>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });

      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          this.pending.delete(id);
          reject(new DOMException('Filter cancelled', 'AbortError'));
        }, { once: true });
      }

      this.getWorker().postMessage(
        { id, type, params, width: buf.width, height: buf.height, data },
        [data],
      );
    });
  }

  async blur(buf: PixelBuffer, radius: number, options?: FilterRunnerOptions): Promise<PixelBuffer> {
    return this.runFilter('gaussianBlur', buf, { radius }, options);
  }

  async boxBlur(buf: PixelBuffer, radius: number, options?: FilterRunnerOptions): Promise<PixelBuffer> {
    return this.runFilter('boxBlur', buf, { radius }, options);
  }

  async unsharpMask(buf: PixelBuffer, radius: number, amount: number, threshold: number, options?: FilterRunnerOptions): Promise<PixelBuffer> {
    return this.runFilter('unsharpMask', buf, { radius, amount, threshold }, options);
  }

  async brightnessContrast(buf: PixelBuffer, brightness: number, contrast: number, options?: FilterRunnerOptions): Promise<PixelBuffer> {
    return this.runFilter('brightnessContrast', buf, { brightness, contrast }, options);
  }

  async hueSaturation(buf: PixelBuffer, hue: number, saturation: number, lightness: number, options?: FilterRunnerOptions): Promise<PixelBuffer> {
    return this.runFilter('hueSaturation', buf, { hue, saturation, lightness }, options);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, entry] of this.pending) {
      entry.reject(new Error('FilterRunner disposed'));
    }
    this.pending.clear();
  }
}

export const filterRunner = new FilterRunner();
