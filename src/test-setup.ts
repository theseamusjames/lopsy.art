import { vi } from 'vitest';

if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as Record<string, unknown>).ImageData = class ImageData {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
    constructor(sw: number | Uint8ClampedArray, sh?: number, _settings?: unknown) {
      if (sw instanceof Uint8ClampedArray) {
        this.data = sw;
        this.width = sh!;
        this.height = sw.length / (4 * sh!);
      } else {
        this.width = sw;
        this.height = sh!;
        this.data = new Uint8ClampedArray(sw * sh! * 4);
      }
    }
  };
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
