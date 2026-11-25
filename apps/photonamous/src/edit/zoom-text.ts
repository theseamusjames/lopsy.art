/**
 * The zoom level as text, for the field under the photo: shown as a whole
 * percentage, and read back from what was typed.
 */

/** '70%' for a zoom of 0.7. */
export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

/**
 * The zoom a typed level asks for (1 for 100 %), held within `min` and
 * `max`: "70", "70%", "70 %" or "62.5". Null when it is not a number
 * above zero.
 */
export function parseZoomText(text: string, min: number, max: number): number | null {
  const match = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(text);
  const digits = match?.[1];
  if (!digits) return null;
  const percent = Number(digits.replace(',', '.'));
  if (!Number.isFinite(percent) || percent <= 0) return null;
  return Math.max(min, Math.min(max, percent / 100));
}
