// Polyfills for jsdom tests that need canvas/ImageData support

if (typeof globalThis.ImageData === 'undefined') {
  class ImageDataPolyfill {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;

    constructor(widthOrData: number | Uint8ClampedArray, heightOrWidth: number, height?: number) {
      if (widthOrData instanceof Uint8ClampedArray) {
        this.data = widthOrData;
        this.width = heightOrWidth;
        this.height = height ?? (widthOrData.length / (4 * heightOrWidth));
      } else {
        this.width = widthOrData;
        this.height = heightOrWidth;
        this.data = new Uint8ClampedArray(widthOrData * heightOrWidth * 4);
      }
    }
  }
  (globalThis as Record<string, unknown>).ImageData = ImageDataPolyfill;
}

// Mock getContext('2d') for HTMLCanvasElement in jsdom.
// Overwriting an overloaded prototype method can't be expressed in TS without
// a cast — so we type the mock function precisely, then cast once at the
// assignment site to the prototype's overloaded signature.
type GetContextFn = typeof HTMLCanvasElement.prototype.getContext;
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const mockGetContext = function (
  this: HTMLCanvasElement,
  contextId: string,
  ...args: unknown[]
): RenderingContext | null {
  if (contextId === '2d') {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const canvas = this;
    return {
      canvas,
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      fill() {},
      stroke() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      setTransform() {},
      resetTransform() {},
      drawImage() {},
      createImageData(w: number, h: number) {
        return new ImageData(w, h);
      },
      getImageData(x: number, y: number, w: number, h: number) {
        void x; void y;
        return new ImageData(w, h);
      },
      putImageData() {},
      measureText(text: string) {
        return { width: text.length * 8 };
      },
      set fillStyle(_v: string | CanvasGradient | CanvasPattern) {},
      get fillStyle() { return '#000000'; },
      set strokeStyle(_v: string | CanvasGradient | CanvasPattern) {},
      get strokeStyle() { return '#000000'; },
      set font(_v: string) {},
      get font() { return '10px sans-serif'; },
      set textAlign(_v: CanvasTextAlign) {},
      get textAlign(): CanvasTextAlign { return 'start'; },
      set textBaseline(_v: CanvasTextBaseline) {},
      get textBaseline(): CanvasTextBaseline { return 'alphabetic'; },
      set globalAlpha(_v: number) {},
      get globalAlpha() { return 1; },
      set globalCompositeOperation(_v: GlobalCompositeOperation) {},
      get globalCompositeOperation(): GlobalCompositeOperation { return 'source-over'; },
      set lineWidth(_v: number) {},
      get lineWidth() { return 1; },
      set lineCap(_v: CanvasLineCap) {},
      get lineCap(): CanvasLineCap { return 'butt'; },
      set lineJoin(_v: CanvasLineJoin) {},
      get lineJoin(): CanvasLineJoin { return 'miter'; },
      set shadowBlur(_v: number) {},
      get shadowBlur() { return 0; },
      set shadowColor(_v: string) {},
      get shadowColor() { return 'rgba(0, 0, 0, 0)'; },
      set shadowOffsetX(_v: number) {},
      get shadowOffsetX() { return 0; },
      set shadowOffsetY(_v: number) {},
      get shadowOffsetY() { return 0; },
      clip() {},
      rect() {},
      quadraticCurveTo() {},
      bezierCurveTo() {},
      arcTo() {},
      isPointInPath() { return false; },
      createLinearGradient() { return {} as CanvasGradient; },
      createRadialGradient() { return {} as CanvasGradient; },
      createPattern() { return null; },
    } as unknown as CanvasRenderingContext2D;
  }
  return originalGetContext.call(this, contextId, ...args);
};
HTMLCanvasElement.prototype.getContext = mockGetContext as GetContextFn;
