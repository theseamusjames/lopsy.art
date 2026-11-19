/**
 * Where Photonamous lives, for handoffs: `VITE_PHOTONAMOUS_URL`, set at build
 * time (the deploy sets `https://photonamous.com/` once Photonamous is
 * deployed; in development, set it to its dev server, `http://localhost:5174/`).
 * Without it Lopsy has no Photonamous to talk to: File → Add to Photonamous
 * is hidden and `?photos-handoff=` is ignored, so Lopsy is exactly as it was.
 * Only this URL's origin is trusted (spec 6.12).
 */

export function photosUrlFor(configured: string | undefined): string | null {
  const trimmed = configured?.trim();
  return trimmed ? trimmed : null;
}

/** The configured Photonamous URL, or null when this build hands off to none. */
export function photosUrl(): string | null {
  return photosUrlFor(import.meta.env.VITE_PHOTONAMOUS_URL);
}

export function isPhotosEnabled(): boolean {
  return photosUrl() !== null;
}
