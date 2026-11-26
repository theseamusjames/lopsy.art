/**
 * The Profile menu (spec 5.4). RAW files list the engine's profiles (the
 * RAW description's `profiles`: the camera's look, the format's own looks
 * where it has some, Neutral, Monochrome) as the engine orders and names
 * them, each entry saying its role, its menu name and whether it is
 * listed; without them, the camera's look, Neutral and Monochrome.
 * JPEG, PNG and WebP offer Standard and Monochrome only (spec 5.4).
 *
 * The recipe's default profile id is 'standard'. On a RAW file that is the
 * camera's look, which the engine calls 'camera': the engine's entry is
 * read under the recipe's id. An engine entry whose own id is 'standard'
 * (a ProRAW's Standard look, beside its Camera) is read as 'standard-look',
 * so the two never share a recipe id (`recipeProfileId`).
 */

import type { RawDevelopSettings } from './raw-develop';

/** A profile's develop settings: everything but the white balance, with the baseline exposure. */
export type ProfileSettings = Partial<Omit<RawDevelopSettings, 'wbRatio'>>;

/** What an engine profile is: the camera's own look, one of the format's looks, flat, or without colour. */
export type ProfileRole = 'camera' | 'look' | 'neutral' | 'monochrome';

export interface DevelopProfile {
  readonly id: string;
  /** The entry's name; `profilesFor` gives the menu's (`menuName`) here. */
  readonly name: string;
  /** What the develop stage takes for this profile, when the engine gives it. */
  readonly settings?: ProfileSettings;
  readonly role?: ProfileRole;
  /** The name the menu prints, as the engine gives it. */
  readonly menuName?: string;
  /** False for the look the camera entry already is, so the menu lists it once. */
  readonly listed?: boolean;
  /** For the camera entry, the id of the look it is. */
  readonly sameAs?: string | null;
  /** Whether the entry is, or stands for, the maker's standard look. */
  readonly makerStandard?: boolean;
}

const ROLES: ReadonlySet<string> = new Set<ProfileRole>(['camera', 'look', 'neutral', 'monochrome']);

const CAMERA_LOOK: DevelopProfile = { id: 'standard', name: 'Camera look' };
/** The engine's id for the camera's own look. */
const ENGINE_CAMERA_ID = 'camera';

/**
 * The recipe's id for an engine profile id: the camera's entry is the
 * recipe's 'standard'; an engine entry that is itself called 'standard'
 * (not the camera) takes 'standard-look', so it is not dropped as a
 * second 'standard' and a recipe saying 'standard' still means the camera.
 */
export function recipeProfileId(engineId: string): string {
  if (engineId === ENGINE_CAMERA_ID) return CAMERA_LOOK.id;
  if (engineId === CAMERA_LOOK.id) return `${CAMERA_LOOK.id}-look`;
  return engineId;
}

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
  const id = recipeProfileId(rawId);
  const settings = readSettings(v.settings);
  return {
    id,
    name,
    ...(settings ? { settings } : {}),
    ...(typeof v.role === 'string' && ROLES.has(v.role) ? { role: v.role as ProfileRole } : {}),
    ...(typeof v.menuName === 'string' && v.menuName !== '' ? { menuName: v.menuName } : {}),
    ...(typeof v.listed === 'boolean' ? { listed: v.listed } : {}),
    ...(typeof v.sameAs === 'string' ? { sameAs: recipeProfileId(v.sameAs) } : v.sameAs === null ? { sameAs: null } : {}),
    ...(typeof v.makerStandard === 'boolean' ? { makerStandard: v.makerStandard } : {}),
  };
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

/**
 * The menu for a photo. A RAW file with engine profiles gets the engine's
 * list, in its order, without the entries it marks as not listed (the
 * look the camera entry already is), each under the engine's menu name.
 * The engine's entries keep their settings for the develop stage whether
 * listed or not (`rawSettingsFor` finds a recipe's profile among all of
 * them).
 */
export function profilesFor(isRaw: boolean, engineProfiles: readonly DevelopProfile[]): DevelopProfile[] {
  if (!isRaw) return [...IMAGE_PROFILES];
  if (engineProfiles.length === 0) return [...RAW_FALLBACK_PROFILES];
  return engineProfiles.filter((p) => p.listed !== false).map((p) => ({ ...p, name: p.menuName ?? p.name }));
}

/** The menu entry the recipe's profile id selects; an unknown id shows as the first entry. */
export function selectedProfile(profiles: readonly DevelopProfile[], id: string): DevelopProfile | null {
  return profiles.find((p) => p.id === id) ?? profiles[0] ?? null;
}
