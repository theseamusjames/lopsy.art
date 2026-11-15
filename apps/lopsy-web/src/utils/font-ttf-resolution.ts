// Generation-time resolution of google/fonts repo TTF paths for the font
// catalog. Used by scripts/generate-font-catalog.ts — not imported by app
// code. Given the repo's full .ttf file list, decides which file(s) serve a
// family so the runtime loader can fetch exactly one URL instead of probing
// filename conventions. Ambiguity resolves to null: the runtime css2
// fallback downloads the correct latin-subset WOFF2, so a wrong guess here
// (e.g. an italic face for an upright request) is strictly worse than no
// guess.

export interface RepoTtfFile {
  /** Repo-relative path, e.g. "ofl/roboto/Roboto[wdth,wght].ttf" */
  readonly path: string;
  readonly size: number;
}

export interface ResolvedTtf {
  /** Family directory in the repo, e.g. "ofl/roboto"; null if absent. */
  readonly ttfDir: string | null;
  /** Single file (relative to ttfDir) covering every weight — variable
   *  fonts and single-file families. Mutually exclusive with weight map. */
  readonly ttfFile: string | null;
  /** Per-weight files (relative to ttfDir) for static families. Weights
   *  without an entry fall back to the css2 API at runtime. */
  readonly ttfWeightFiles: Readonly<Partial<Record<number, string>>> | null;
}

const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
};

const LICENSE_DIRS = ['ofl', 'apache', 'ufl'] as const;

// jsDelivr refuses files over 20 MB with a 403, so a bigger file can never
// load at runtime — treat it as absent and let the css2 fallback serve it.
const JSDELIVR_MAX_BYTES = 20 * 1024 * 1024;

const NONE: ResolvedTtf = { ttfDir: null, ttfFile: null, ttfWeightFiles: null };

function familySlug(family: string): string {
  return family.toLowerCase().replace(/\s+/g, '');
}

function familyNoSpaces(family: string): string {
  return family.replace(/\s+/g, '');
}

/**
 * Static per-weight file: any "<Prefix>-<WeightName>.ttf" in the family's
 * dir. The prefix is usually the family name without spaces, but legacy
 * families deviate (PT_Sans-Web-Regular.ttf, OldStandard-Regular.ttf).
 * Since the directory belongs to exactly one family, a weight-named file
 * in it is that family's face — but if several prefixes offer the same
 * weight, the choice is ambiguous and we bail to the css2 fallback.
 * Root-level files win over static/ copies.
 */
function findStaticForWeight(files: readonly string[], noSpaces: string, weight: number): string | null {
  const weightName = WEIGHT_NAMES[weight];
  if (!weightName) return null;
  const suffix = `-${weightName}.ttf`;
  const matches = files.filter((f) => f.endsWith(suffix));
  if (matches.length === 0) return null;

  const exact = `${noSpaces}${suffix}`;
  for (const pool of [matches.filter((f) => !f.includes('/')), matches]) {
    const exactMatch = pool.find((f) => f === exact || f.endsWith(`/${exact}`));
    if (exactMatch) return exactMatch;
    const prefixes = new Set(pool.map((f) => f.slice(0, -suffix.length)));
    if (prefixes.size === 1 && pool[0] !== undefined) return pool[0];
  }
  return null;
}

/**
 * Upright variable file: "<Family>[<any axes>].ttf" or
 * "<Family>-VariableFont_<axes>.ttf". One file serves every weight.
 */
function findVariableFile(files: readonly string[], noSpaces: string): string | null {
  const bracket = files.find((f) => new RegExp(`^${escapeRegExp(noSpaces)}\\[[^\\]]+\\]\\.ttf$`).test(f));
  if (bracket) return bracket;
  return files.find((f) => f.startsWith(`${noSpaces}-VariableFont_`) && f.endsWith('.ttf')) ?? null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveTtfPaths(
  family: string,
  weights: readonly number[],
  repoFiles: readonly RepoTtfFile[],
): ResolvedTtf {
  const slug = familySlug(family);
  const noSpaces = familyNoSpaces(family);

  let dir: string | null = null;
  let files: string[] = [];
  for (const license of LICENSE_DIRS) {
    const prefix = `${license}/${slug}/`;
    const inDir = repoFiles.filter((f) => f.path.startsWith(prefix) && f.size <= JSDELIVR_MAX_BYTES);
    if (inDir.length > 0) {
      dir = `${license}/${slug}`;
      files = inDir.map((f) => f.path.slice(prefix.length));
      break;
    }
  }
  if (dir === null) return NONE;

  const statics: Partial<Record<number, string>> = {};
  let staticCount = 0;
  for (const w of weights) {
    const file = findStaticForWeight(files, noSpaces, w);
    if (file !== null) {
      statics[w] = file;
      staticCount++;
    }
  }
  if (staticCount === weights.length) {
    return { ttfDir: dir, ttfFile: null, ttfWeightFiles: statics };
  }

  const variable = findVariableFile(files, noSpaces);
  if (variable) return { ttfDir: dir, ttfFile: variable, ttfWeightFiles: null };

  if (staticCount > 0) {
    return { ttfDir: dir, ttfFile: null, ttfWeightFiles: statics };
  }

  const bare = files.find((f) => f === `${noSpaces}.ttf`);
  if (bare) return { ttfDir: dir, ttfFile: bare, ttfWeightFiles: null };

  const rootTtfs = files.filter((f) => !f.includes('/'));
  if (rootTtfs.length === 1 && rootTtfs[0] !== undefined) {
    return { ttfDir: dir, ttfFile: rootTtfs[0], ttfWeightFiles: null };
  }

  const italicOnly = files.find((f) => f === `${noSpaces}-Italic.ttf`);
  if (italicOnly) return { ttfDir: dir, ttfFile: italicOnly, ttfWeightFiles: null };

  return NONE;
}
