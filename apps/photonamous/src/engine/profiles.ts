/**
 * The Profile menu (spec 5.4). RAW files list the engine's profiles (the
 * RAW description's `profiles`: the camera's look, the format's own looks
 * where it has some, Neutral, Monochrome); without them, the camera's
 * look, Neutral and Monochrome.
 * JPEG, PNG and WebP offer Standard and Monochrome only (spec 5.4).
 *
 * The recipe's default profile id is 'standard'. On a RAW file that is the
 * camera's look, which the engine calls 'camera': the engine's entry is
 * read under the recipe's id.
 */

import type { RawDevelopSettings } from './raw-develop';

/** A profile's develop settings: everything but the white balance, with the baseline exposure. */
export type ProfileSettings = Partial<Omit<RawDevelopSettings, 'wbRatio'>>;

export interface DevelopProfile {
  readonly id: string;
  /** As the menu shows it. */
  readonly name: string;
  /** What the develop stage takes for this profile, when the engine gives it. */
  readonly settings?: ProfileSettings;
}

const CAMERA_LOOK: DevelopProfile = { id: 'standard', name: 'Camera look' };
/** The engine's id for the camera's own look. */
const ENGINE_CAMERA_ID = 'camera';

export const RAW_FALLBACK_PROFILES: readonly DevelopProfile[] = [
  CAMERA_LOOK,
  { id: 'neutral', name: 'Neutral' },
  { id: 'monochrome', name: 'Monochrome' },
];

export const IMAGE_PROFILES: readonly DevelopProfile[] = [
  { id: 'standard', name: 'Standard' },
  { id: 'monochrome', name: 'Monochrome' },
];

function isNumbers(value: unknown, length?: number): value is number[] {
  return (
    Array.isArray(value) &&
    (length === undefined || value.length === length) &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

function readSettings(value: unknown): ProfileSettings | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const out: { -readonly [K in keyof ProfileSettings]: ProfileSettings[K] } = {};
  if (isNumbers(v.camToRgb, 9)) out.camToRgb = v.camToRgb;
  if (typeof v.exposureEv === 'number' && Number.isFinite(v.exposureEv)) out.exposureEv = v.exposureEv;
  if (typeof v.saturation === 'number' && Number.isFinite(v.saturation)) out.saturation = v.saturation;
  if (typeof v.highlightDesaturation === 'boolean') out.highlightDesaturation = v.highlightDesaturation;
  if (v.baseCurve === null) out.baseCurve = null;
  else if (isNumbers(v.baseCurve) && v.baseCurve.length >= 2) out.baseCurve = v.baseCurve;
  return Object.keys(out).length > 0 ? out : undefined;
}

function readProfile(value: unknown): DevelopProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const rawId = v.id;
  const name = typeof v.name === 'string' ? v.name : typeof v.label === 'string' ? v.label : null;
  if (typeof rawId !== 'string' || rawId === '' || name === null) return null;
  const id = rawId === ENGINE_CAMERA_ID ? CAMERA_LOOK.id : rawId;
  const settings = readSettings(v.settings);
  return settings ? { id, name, settings } : { id, name };
}

/**
 * Reads the engine's profile list: an array of `{ id, name, settings }`, or
 * an object holding one under `profiles`. Entries without an id or a name
 * are left out; an unreadable answer gives an empty list.
 */
export function parseDevelopProfiles(json: string): DevelopProfile[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  return readDevelopProfiles(raw);
}

/** `parseDevelopProfiles` of a value already parsed (a RAW description's `profiles`). */
export function readDevelopProfiles(raw: unknown): DevelopProfile[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).profiles : null;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: DevelopProfile[] = [];
  for (const entry of list) {
    const profile = readProfile(entry);
    if (!profile || seen.has(profile.id)) continue;
    seen.add(profile.id);
    out.push(profile);
  }
  return out;
}

/** The engine's id of the look Fujifilm calls Standard. */
const STANDARD_LOOK_ID = 'provia';

/**
 * The menu for a photo. A RAW file with engine profiles gets those, with
 * the camera's look first, and Neutral and Monochrome added when the
 * engine left them out.
 *
 * The camera's look is one of the film looks ("Camera (Velvia look)"), so
 * that look is not listed a second time. Provia is Fujifilm's Standard and
 * is called so; when it is the camera's own look, the camera entry says it.
 */
export function profilesFor(isRaw: boolean, engineProfiles: readonly DevelopProfile[]): DevelopProfile[] {
  if (!isRaw) return [...IMAGE_PROFILES];
  if (engineProfiles.length === 0) return [...RAW_FALLBACK_PROFILES];
  const byId = new Map(engineProfiles.map((p) => [p.id, p]));
  let camera = byId.get(CAMERA_LOOK.id) ?? CAMERA_LOOK;
  const recorded = /^Camera \((.+)\)$/.exec(camera.name)?.[1] ?? null;
  const out: DevelopProfile[] = [];
  for (const p of engineProfiles) {
    if (p.id === CAMERA_LOOK.id) continue;
    if (recorded !== null && p.name === recorded) {
      if (p.id === STANDARD_LOOK_ID) camera = { ...camera, name: `Camera (${recorded}, Standard)` };
      continue;
    }
    out.push(p.id === STANDARD_LOOK_ID ? { ...p, name: `Standard (${p.name})` } : p);
  }
  for (const p of RAW_FALLBACK_PROFILES) if (!byId.has(p.id) && p.id !== CAMERA_LOOK.id) out.push(p);
  return [camera, ...out];
}

/** The menu entry the recipe's profile id selects; an unknown id shows as the first entry. */
export function selectedProfile(profiles: readonly DevelopProfile[], id: string): DevelopProfile | null {
  return profiles.find((p) => p.id === id) ?? profiles[0] ?? null;
}
