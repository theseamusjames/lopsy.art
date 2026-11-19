/**
 * Where Photonamous lives, for handoffs: `VITE_PHOTOS_URL`, set at build
 * time by builds that ship Photos (the site build sets `/photos/`; in
 * development, set it to the Photos dev server, `http://localhost:5174/`).
 * Without it Lopsy has no Photos to talk to: File → Add to Photonamous is
 * hidden and `?photos-handoff=` is ignored, so Lopsy is exactly as it was.
 * Only this URL's origin is trusted (spec 6.12).
 */

export function photosUrlFor(configured: string | undefined): string | null {
  const trimmed = configured?.trim();
  return trimmed ? trimmed : null;
}

/** The configured Photos URL, or null when this build does not ship Photos. */
export function photosUrl(): string | null {
  return photosUrlFor(import.meta.env.VITE_PHOTOS_URL);
}

export function isPhotosEnabled(): boolean {
  return photosUrl() !== null;
}
