import type { Layer } from '../types';

/**
 * Next free `<prefix> <n>` name: one above the highest number already used
 * with that prefix. Counting entries instead would include groups and reuse a
 * name after a delete.
 */
export function nextDefaultLayerName(layers: readonly Layer[], prefix: string): string {
  const pattern = new RegExp(`^${escapeRegExp(prefix)} (\\d+)$`);
  let highest = 0;
  for (const layer of layers) {
    const match = pattern.exec(layer.name);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isSafeInteger(n) && n > highest) highest = n;
  }
  return `${prefix} ${highest + 1}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
