/// <reference lib="webworker" />

import { PixelBuffer } from '../engine/pixel-data';
import { gaussianBlur, boxBlur } from './blur';
import { unsharpMask } from './sharpen';
import { addNoise, fillWithNoise } from './noise';
import {
  brightnessContrast,
  hueSaturation,
  invert,
  desaturate,
  posterize,
  threshold,
} from './adjustments';

interface FilterMessage {
  id: string;
  type: string;
  params: Record<string, unknown>;
  width: number;
  height: number;
  data: ArrayBuffer;
}

interface FilterResult {
  id: string;
  width: number;
  height: number;
  data: ArrayBuffer;
}

self.onmessage = (e: MessageEvent<FilterMessage>) => {
  const { id, type, params, width, height, data } = e.data;
  const pixelData = new Uint8ClampedArray(data);
  const buf = PixelBuffer.fromData(pixelData, width, height);

  let result: PixelBuffer;

  switch (type) {
    case 'gaussianBlur':
      result = gaussianBlur(buf, params.radius as number);
      break;
    case 'boxBlur':
      result = boxBlur(buf, params.radius as number);
      break;
    case 'unsharpMask':
      result = unsharpMask(buf, params.radius as number, params.amount as number, params.threshold as number);
      break;
    case 'addNoise':
      result = addNoise(buf, params.amount as number, params.noiseType as 'gaussian' | 'uniform', params.monochromatic as boolean);
      break;
    case 'fillWithNoise':
      result = fillWithNoise(buf, params.noiseType as 'gaussian' | 'uniform', params.monochromatic as boolean);
      break;
    case 'brightnessContrast':
      result = brightnessContrast(buf, params.brightness as number, params.contrast as number);
      break;
    case 'hueSaturation':
      result = hueSaturation(buf, params.hue as number, params.saturation as number, params.lightness as number);
      break;
    case 'invert':
      result = invert(buf);
      break;
    case 'desaturate':
      result = desaturate(buf);
      break;
    case 'posterize':
      result = posterize(buf, params.levels as number);
      break;
    case 'threshold':
      result = threshold(buf, params.level as number);
      break;
    default:
      result = buf;
  }

  const rawData = result.rawData;
  const resultBuffer = rawData.buffer.slice(rawData.byteOffset, rawData.byteOffset + rawData.byteLength) as ArrayBuffer;
  const response: FilterResult = {
    id,
    width: result.width,
    height: result.height,
    data: resultBuffer,
  };

  self.postMessage(response, [resultBuffer]);
};
