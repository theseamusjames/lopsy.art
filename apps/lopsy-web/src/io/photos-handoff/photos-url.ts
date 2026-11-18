/**
 * Where Lopsy Photos lives, for handoffs. `VITE_PHOTOS_URL` overrides the
 * default: the Photos dev server in development, `/photos/` on this origin
 * in a production build. Only this URL's origin is trusted (spec 6.12).
 */

export const DEV_PHOTOS_URL = 'http://localhost:5174/';
export const PRODUCTION_PHOTOS_URL = '/photos/';

export function photosUrlFor(configured: string | undefined, isDev: boolean): string {
  const trimmed = configured?.trim();
  if (trimmed) return trimmed;
  return isDev ? DEV_PHOTOS_URL : PRODUCTION_PHOTOS_URL;
}

export function photosUrl(): string {
  return photosUrlFor(import.meta.env.VITE_PHOTOS_URL, import.meta.env.DEV);
}
