/**
 * Fill layer pixel generation.
 *
 * Given a FillConfig and document dimensions, returns a Uint8ClampedArray of
 * RGBA pixels covering the full document canvas. This is the Option A approach:
 * generate fill pixels on the JS side and upload as a regular raster layer
 * texture via the existing uploadLayerPixels path.
 *
 * This module is pure logic — no DOM, no React, no GPU calls.
 */

import type { FillConfig } from '../types';
import { interpolateGradient, computeLinearGradientT, computeRadialGradientT } from '../tools/gradient/gradient';

/**
 * Generate RGBA pixel data for a fill layer covering (width × height) pixels.
 * Returns a Uint8ClampedArray of length width * height * 4.
 */
export function generateFillPixels(
  fill: FillConfig,
  width: number,
  height: number,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);

  if (fill.type === 'solid-color') {
    return generateSolidColorPixels(fill.color, width, height, pixels);
  }

  if (fill.type === 'gradient') {
    return generateGradientPixels(fill, width, height, pixels);
  }

  // Pattern fill: fill with a neutral grey checkerboard pattern to represent
  // the pattern. Real pattern rendering would require the pattern texture.
  return generatePatternPixels(fill, width, height, pixels);
}

function generateSolidColorPixels(
  color: { r: number; g: number; b: number; a: number },
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): Uint8ClampedArray {
  const r = Math.round(color.r);
  const g = Math.round(color.g);
  const b = Math.round(color.b);
  const a = Math.round(color.a * 255);

  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    pixels[offset + 3] = a;
  }

  return pixels;
}

function generateGradientPixels(
  fill: import('../types').GradientFill,
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): Uint8ClampedArray {
  const stops = fill.reverse ? [...fill.stops].reverse().map((s, i, arr) => ({
    ...s,
    position: arr[arr.length - 1 - i]?.position ?? s.position,
  })) : fill.stops;

  const centerX = width / 2;
  const centerY = height / 2;

  if (fill.gradientType === 'linear') {
    // Convert angle (degrees) to start/end points spanning the full canvas
    const angleRad = (fill.angle - 90) * (Math.PI / 180);
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);
    // Scale so the gradient spans the full diagonal
    const len = Math.abs(dx * width) + Math.abs(dy * height);
    const startX = centerX - (dx * len) / 2;
    const startY = centerY - (dy * len) / 2;
    const endX = centerX + (dx * len) / 2;
    const endY = centerY + (dy * len) / 2;

    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const t = computeLinearGradientT(px, py, startX, startY, endX, endY);
        const color = interpolateGradient(stops, t);
        const offset = (py * width + px) * 4;
        pixels[offset] = color.r;
        pixels[offset + 1] = color.g;
        pixels[offset + 2] = color.b;
        pixels[offset + 3] = Math.round(color.a * 255);
      }
    }
  } else {
    // Radial: from center outward, radius = half the shorter dimension
    const radius = Math.min(width, height) / 2;

    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const t = computeRadialGradientT(px, py, centerX, centerY, radius);
        const color = interpolateGradient(stops, t);
        const offset = (py * width + px) * 4;
        pixels[offset] = color.r;
        pixels[offset + 1] = color.g;
        pixels[offset + 2] = color.b;
        pixels[offset + 3] = Math.round(color.a * 255);
      }
    }
  }

  return pixels;
}

function generatePatternPixels(
  fill: import('../types').PatternFill,
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): Uint8ClampedArray {
  // Render a checkerboard pattern as a placeholder for pattern fills.
  // The tile size is controlled by fill.scale (default 1.0 = 32px tiles).
  const tileSize = Math.max(4, Math.round(32 * fill.scale));

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const tx = Math.floor((px + fill.offsetX) / tileSize);
      const ty = Math.floor((py + fill.offsetY) / tileSize);
      const isLight = (tx + ty) % 2 === 0;
      const value = isLight ? 204 : 153;
      const offset = (py * width + px) * 4;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }

  return pixels;
}

/**
 * Produce a string key representing the fill configuration so callers can
 * cheaply detect when a re-upload is needed.
 */
export function fillConfigKey(fill: FillConfig): string {
  return JSON.stringify(fill);
}
