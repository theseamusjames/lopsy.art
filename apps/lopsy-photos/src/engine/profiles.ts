/**
 * The Profile menu (spec 5.4). RAW files list the engine's profiles when the
 * engine provides them (`rafDevelopProfiles`); until then, or for a camera
 * it has none for, the camera's own look, Neutral and Monochrome. JPEG, PNG
 * and WebP offer Standard and Monochrome only (spec 5.4, last paragraph).
 */

export interface DevelopProfile {
  readonly id: string;
  /** As the menu shows it. */
  readonly name: string;
  /** Settings the develop stage takes for this profile, when the engine gives them. */
  readonly saturation?: number;
  readonly baseCurve?: readonly number[] | null;
}

/** 'standard' is the recipe default: on a RAW file, the camera's own look. */
const CAMERA_LOOK: DevelopProfile = { id: 'standard', name: 'Camera look' };

export const RAW_FALLBACK_PROFILES: readonly DevelopProfile[] = [
  CAMERA_LOOK,
  { id: 'neutral', name: 'Neutral' },
  { id: 'monochrome', name: 'Monochrome' },
];

export const IMAGE_PROFILES: readonly DevelopProfile[] = [
  { id: 'standard', name: 'Standard' },
  { id: 'monochrome', name: 'Monochrome' },
];

function readProfile(value: unknown): DevelopProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const id = v.id;
  const name = typeof v.name === 'string' ? v.name : typeof v.label === 'string' ? v.label : null;
  if (typeof id !== 'string' || id === '' || name === null) return null;
  const curve = v.baseCurve;
  const isCurve = Array.isArray(curve) && curve.length >= 2 && curve.every((n) => typeof n === 'number' && Number.isFinite(n));
  return {
    id,
    name,
    ...(typeof v.saturation === 'number' && Number.isFinite(v.saturation) ? { saturation: v.saturation } : {}),
    ...(isCurve ? { baseCurve: curve as number[] } : curve === null ? { baseCurve: null } : {}),
  };
}

/**
 * Reads the engine's profile list: an array of `{ id, name, … }`, or an
 * object holding one under `profiles`. Entries without an id or a name are
 * left out; an unreadable answer gives an empty list.
 */
export function parseDevelopProfiles(json: string): DevelopProfile[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
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
 * The menu for a photo. A RAW file with engine profiles gets those, with
 * 'standard' first (as the camera's look) and Neutral and Monochrome
 * added when the engine left them out.
 */
export function profilesFor(isRaw: boolean, engineProfiles: readonly DevelopProfile[]): DevelopProfile[] {
  if (!isRaw) return [...IMAGE_PROFILES];
  if (engineProfiles.length === 0) return [...RAW_FALLBACK_PROFILES];
  const byId = new Map(engineProfiles.map((p) => [p.id, p]));
  const out: DevelopProfile[] = [byId.get('standard') ?? CAMERA_LOOK];
  for (const p of engineProfiles) if (p.id !== 'standard') out.push(p);
  for (const p of RAW_FALLBACK_PROFILES) if (!byId.has(p.id) && p.id !== 'standard') out.push(p);
  return out;
}

/** The menu entry the recipe's profile id selects; an unknown id shows as the first entry. */
export function selectedProfile(profiles: readonly DevelopProfile[], id: string): DevelopProfile | null {
  return profiles.find((p) => p.id === id) ?? profiles[0] ?? null;
}
