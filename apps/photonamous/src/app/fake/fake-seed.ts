/**
 * DEVELOPMENT DOUBLE. Fills a FakeSession with believable photos so the
 * library has something to show. `?seed=50000` in the URL sets the count.
 */

import type { ColorLabel, Rating } from '@lopsy/photos-core/library/types';
import { DEFAULT_RECIPE } from '@lopsy/photos-core/library/recipe';
import type { FakeSession } from './fake-session';

const CAMERAS = [
  { make: 'FUJIFILM', model: 'X-T5', lens: 'XF16-55mmF2.8 R LM WR' },
  { make: 'FUJIFILM', model: 'X100VI', lens: '23mm F2' },
  { make: 'Apple', model: 'iPhone 16 Pro', lens: 'iPhone 16 Pro back camera 6.86mm f/1.78' },
];
const KEYWORDS = ['beach', 'family', 'street', 'night', 'mountains', 'food', 'dog'];
const LABELS: ColorLabel[] = ['red', 'yellow', 'green', 'blue', 'purple'];
const SHUTTERS = ['1/30', '1/125', '1/250', '1/500', '1/1000', '2'];

/** A small deterministic generator, so the seeded library is the same on every load. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

export function seedLibrary(session: FakeSession, count: number): void {
  const rand = prng(42);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rand() * items.length)] as T;
  const imports = ['import-a', 'import-b', 'import-c'];
  const start = Date.UTC(2025, 5, 1);
  const albumTrip = count > 0 ? session.createAlbum('Summer trip') : null;
  const albumBest = count > 0 ? session.createAlbum('Best of the year') : null;
  for (let i = 0; i < count; i++) {
    const cam = pick(CAMERAS);
    const t = new Date(start + i * 47 * 60_000 + Math.floor(rand() * 600_000));
    const capturedAt = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1, 2)}-${pad(t.getUTCDate(), 2)}T${pad(t.getUTCHours(), 2)}:${pad(t.getUTCMinutes(), 2)}:${pad(t.getUTCSeconds(), 2)}`;
    const importIndex = Math.min(imports.length - 1, Math.floor((i / Math.max(1, count)) * imports.length));
    const portrait = rand() < 0.2;
    const isRaw = cam.make === 'FUJIFILM' && rand() < 0.6;
    const stem = `${cam.make === 'Apple' ? 'IMG_' : 'DSCF'}${pad(i + 1, 4)}`;
    const fileName = `${stem}.${isRaw ? 'RAF' : 'JPG'}`;
    const roll = rand();
    const rating = (roll < 0.5 ? 0 : Math.ceil((roll - 0.5) * 10)) as Rating;
    const importedAt = new Date(Date.UTC(2026, 9, 1 + importIndex * 10, 12, 0, 0) + i).toISOString();
    const base = {
      kind: 'original' as const,
      fileId: `fake-file:${i}`,
      sha256: `fake-sha:${i}`,
      byteSize: isRaw ? 48_000_000 + Math.floor(rand() * 9_000_000) : 6_000_000 + Math.floor(rand() * 4_000_000),
      capturedAt,
      importedAt,
      importId: imports[importIndex] ?? 'import-a',
      width: portrait ? 4000 : 6000,
      height: portrait ? 6000 : 4000,
      orientation: 1,
      camera: { make: cam.make, model: cam.model },
      lens: cam.lens,
      exposure: { iso: pick([125, 200, 400, 800, 3200]), shutter: pick(SHUTTERS), aperture: pick([1.8, 2.8, 4, 5.6, 8]), focalLength: pick([16, 23, 35, 55]) },
      gps: null,
      pairedWith: null,
      source: null,
      renderFileId: null,
    };
    const marks = {
      rating,
      label: rand() < 0.15 ? pick(LABELS) : null,
      setAside: rand() < 0.06,
      title: '',
      caption: '',
    };
    const keywords = rand() < 0.4 ? [pick(KEYWORDS)] : [];
    const edited = rand() < 0.2;
    const recipe = edited ? { ...DEFAULT_RECIPE, tone: { ...DEFAULT_RECIPE.tone, exposure: 0.3 } } : undefined;
    const { assetId } = session.addAsset({
      ...base,
      fileName,
      format: isRaw ? 'raf' : 'jpeg',
      mimeType: isRaw ? 'image/x-fujifilm-raf' : 'image/jpeg',
      marks,
      keywords,
      recipe,
    });
    if (isRaw && rand() < 0.4) {
      const jpeg = session.addAsset({
        ...base,
        fileId: `fake-file:${i}j`,
        sha256: `fake-sha:${i}j`,
        byteSize: 9_000_000,
        fileName: `${stem}.JPG`,
        format: 'jpeg',
        mimeType: 'image/jpeg',
        marks,
        keywords,
      });
      session.linkPair(assetId, jpeg.assetId);
    }
    if (albumTrip && i % 9 === 0) session.setAlbumMember(albumTrip, assetId, true);
    if (albumBest && rating === 5) session.setAlbumMember(albumBest, assetId, true);
  }
  session.markSynced();
}
