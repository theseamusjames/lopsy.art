/**
 * DEVELOPMENT DOUBLE. Previews for the fake backend: imported JPEG/PNG
 * files are downscaled with createImageBitmap + OffscreenCanvas; every
 * other photo gets a small generated picture (a colour gradient and its
 * file name), so tiles are told apart at a glance.
 */

import type { PreviewRef } from '@lopsy/photos-core/library/types';

/** Imported files the fake keeps in memory as its "storage", by asset id. */
const importedFiles = new Map<string, Blob>();

export function rememberImportedFile(assetId: string, file: Blob): void {
  importedFiles.set(assetId, file);
}

function hashHue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  // Final avalanche so ids that differ only at the end spread over the wheel.
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b) >>> 0;
  h ^= h >>> 16;
  return h % 360;
}

async function renderFile(file: Blob, ref: PreviewRef): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, Math.max(ref.width, ref.height) / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

async function renderGenerated(assetId: string, label: string, ref: PreviewRef): Promise<Blob> {
  const canvas = new OffscreenCanvas(ref.width, ref.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  const hue = hashHue(assetId);
  const gradient = ctx.createLinearGradient(0, 0, ref.width, ref.height);
  gradient.addColorStop(0, `hsl(${hue} 45% 38%)`);
  gradient.addColorStop(1, `hsl(${(hue + 50) % 360} 55% 18%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ref.width, ref.height);
  ctx.fillStyle = `hsl(${(hue + 180) % 360} 60% 70% / 0.35)`;
  ctx.beginPath();
  ctx.arc(ref.width * 0.68, ref.height * 0.4, Math.min(ref.width, ref.height) * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `600 ${Math.round(Math.min(ref.width, ref.height) / 12)}px sans-serif`;
  ctx.fillText(label, ref.width * 0.06, ref.height * 0.9);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

/** `label` is the file name drawn on generated previews. */
export async function readFakePreview(ref: PreviewRef, label: string): Promise<Blob> {
  await new Promise((r) => setTimeout(r, 30 + Math.random() * 120));
  const [, assetId = ''] = ref.fileId.split(':');
  const file = importedFiles.get(assetId);
  if (file) {
    try {
      return await renderFile(file, ref);
    } catch {
      // Not decodable by the browser (a RAW): fall through to a generated picture.
    }
  }
  return renderGenerated(assetId, label, ref);
}
