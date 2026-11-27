/** How facts about a photo are written in the Info panel. */

import type { CameraInfo, ExposureInfo } from '@lopsy/photos-core/library/types';

/** '2026-11-14T16:02:11' -> '14 Nov 2026, 16:02'. The camera's clock time is shown as is, with no time zone change. */
export function formatCaptureTime(value: string | null): string {
  if (value === null) return 'Unknown';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!m) return value;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [, y, mo, d, h, mi] = m;
  const date = `${Number(d)} ${months[Number(mo) - 1] ?? mo} ${y}`;
  return h !== undefined && mi !== undefined ? `${date}, ${h}:${mi}` : date;
}

export function formatCamera(camera: CameraInfo | null): string | null {
  if (camera === null) return null;
  // Many cameras repeat the make in the model ("Canon EOS R5"), or its first word ("NIKON D850" by "NIKON CORPORATION").
  if (camera.model.toLowerCase().startsWith(camera.make.toLowerCase())) return camera.model;
  const brand = camera.make.split(/\s+/)[0] ?? '';
  if (brand.length > 1 && camera.model.toLowerCase().startsWith(`${brand.toLowerCase()} `)) return camera.model;
  const make = camera.make.length > 1 ? camera.make[0] + camera.make.slice(1).toLowerCase() : camera.make;
  return `${make} ${camera.model}`;
}

export function formatExposure(exposure: ExposureInfo | null): string | null {
  if (exposure === null) return null;
  const parts: string[] = [];
  if (exposure.shutter) parts.push(`${exposure.shutter} s`);
  if (exposure.aperture !== null) parts.push(`f/${exposure.aperture}`);
  if (exposure.iso !== null) parts.push(`ISO ${exposure.iso}`);
  if (exposure.focalLength !== null) parts.push(`${exposure.focalLength} mm`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function formatDimensions(width: number | null, height: number | null): string | null {
  if (width === null || height === null) return null;
  const mp = (width * height) / 1_000_000;
  return `${width} × ${height} (${mp >= 10 ? Math.round(mp) : mp.toFixed(1)} MP)`;
}
