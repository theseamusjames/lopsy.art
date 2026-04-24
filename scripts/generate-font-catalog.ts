/**
 * One-time script to generate src/utils/font-catalog.ts
 *
 * Fetches Google Fonts metadata and matches against getstencil preview images.
 * Run: npx tsx scripts/generate-font-catalog.ts
 */

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const METADATA_URL = 'https://fonts.google.com/metadata/fonts';
const GETSTENCIL_ZIP = 'https://github.com/getstencil/GoogleWebFonts-FontFamilyPreviewImages/archive/refs/heads/master.zip';
const TMP_DIR = join(import.meta.dirname!, '..', '.tmp-font-gen');
const OUTPUT_PATH = join(import.meta.dirname!, '..', 'src', 'utils', 'font-catalog.ts');

interface GoogleFontMeta {
  family: string;
  subsets: string[];
  fonts: Record<string, { thickness: number | null; slant: number | null; width: number | null; lineHeight: number }>;
  axes: Array<{ tag: string; min: number; max: number }>;
  designers: string[];
  lastModified: string;
  dateAdded: string;
  popularity: number;
  defSubset: string;
  defVariant: string;
  category: string;
  stroke: string;
  classifications: string[];
}

interface MetadataResponse {
  axisRegistry: unknown[];
  familyMetadataList: GoogleFontMeta[];
}

type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace';

function normalizeCategory(raw: string): FontCategory {
  const map: Record<string, FontCategory> = {
    'Sans Serif': 'sans-serif',
    'Serif': 'serif',
    'Display': 'display',
    'Handwriting': 'handwriting',
    'Monospace': 'monospace',
  };
  return map[raw] ?? 'sans-serif';
}

function toPreviewSlug(family: string): string {
  return family.replace(/[^a-zA-Z0-9]/g, '');
}

function extractWeights(fonts: Record<string, unknown>): { weights: number[]; hasItalic: boolean } {
  const weights = new Set<number>();
  let hasItalic = false;

  for (const key of Object.keys(fonts)) {
    const match = key.match(/^(\d+)(i?)$/);
    if (match) {
      weights.add(Number(match[1]));
      if (match[2] === 'i') hasItalic = true;
    }
  }

  const sorted = [...weights].sort((a, b) => a - b);
  return { weights: sorted.length > 0 ? sorted : [400], hasItalic };
}

async function fetchMetadata(): Promise<GoogleFontMeta[]> {
  console.log('Fetching Google Fonts metadata...');
  const res = await fetch(METADATA_URL);
  if (!res.ok) throw new Error(`Failed to fetch metadata: ${res.status}`);
  const data = (await res.json()) as MetadataResponse;
  console.log(`  Got ${data.familyMetadataList.length} font families`);
  return data.familyMetadataList;
}

function downloadAndExtractPreviews(): Map<string, string> {
  console.log('Downloading getstencil preview images repo...');

  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const zipPath = join(TMP_DIR, 'repo.zip');
  execSync(`curl -sL "${GETSTENCIL_ZIP}" -o "${zipPath}"`, { stdio: 'inherit' });
  execSync(`unzip -q "${zipPath}" -d "${TMP_DIR}"`, { stdio: 'inherit' });

  // Find the extracted directory (usually GoogleWebFonts-FontFamilyPreviewImages-master)
  const extracted = readdirSync(TMP_DIR).find(d => d.startsWith('GoogleWebFonts'));
  if (!extracted) throw new Error('Could not find extracted repo directory');

  const compressedDir = join(TMP_DIR, extracted, '48px', 'compressed');
  if (!existsSync(compressedDir)) {
    // Fall back to 48px directly if no compressed subdir
    const fallbackDir = join(TMP_DIR, extracted, '48px');
    if (!existsSync(fallbackDir)) throw new Error('Could not find 48px directory');
    return buildPreviewMap(fallbackDir);
  }

  return buildPreviewMap(compressedDir);
}

function buildPreviewMap(dir: string): Map<string, string> {
  const files = readdirSync(dir);
  const map = new Map<string, string>();

  // Match pattern: {Slug}-400.v{N}.png — only the 400 weight base preview
  const regex = /^(.+)-400\.v(\d+)\.png$/;

  for (const file of files) {
    const match = file.match(regex);
    if (match) {
      const slug = match[1]!;
      const version = Number(match[2]);
      const existing = map.get(slug);
      if (existing) {
        // Keep the highest version
        const existingVersion = Number(existing.match(/\.v(\d+)\./)?.[1] ?? 0);
        if (version > existingVersion) {
          map.set(slug, file);
        }
      } else {
        map.set(slug, file);
      }
    }
  }

  console.log(`  Found ${map.size} preview images for 400-weight`);
  return map;
}

function generateTypeScript(
  googleFonts: GoogleFontMeta[],
  previewMap: Map<string, string>,
): string {
  const systemFonts = [
    { family: 'Inter', category: 'sans-serif' as const, weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], hasItalic: true },
    { family: 'Arial', category: 'sans-serif' as const, weights: [400, 700], hasItalic: true },
    { family: 'Helvetica', category: 'sans-serif' as const, weights: [400, 700], hasItalic: true },
    { family: 'Georgia', category: 'serif' as const, weights: [400, 700], hasItalic: true },
    { family: 'Times New Roman', category: 'serif' as const, weights: [400, 700], hasItalic: true },
    { family: 'Courier New', category: 'monospace' as const, weights: [400, 700], hasItalic: true },
    { family: 'JetBrains Mono', category: 'monospace' as const, weights: [100, 200, 300, 400, 500, 600, 700, 800], hasItalic: true },
    { family: 'Verdana', category: 'sans-serif' as const, weights: [400, 700], hasItalic: true },
    { family: 'Trebuchet MS', category: 'sans-serif' as const, weights: [400, 700], hasItalic: true },
    { family: 'Impact', category: 'sans-serif' as const, weights: [400, 700], hasItalic: false },
    { family: 'Comic Sans MS', category: 'handwriting' as const, weights: [400, 700], hasItalic: true },
    { family: 'Palatino', category: 'serif' as const, weights: [400, 700], hasItalic: true },
    { family: 'Garamond', category: 'serif' as const, weights: [400, 700], hasItalic: true },
    { family: 'Brush Script MT', category: 'handwriting' as const, weights: [400], hasItalic: false },
  ];

  // Sort Google Fonts by popularity (lower number = more popular)
  const sorted = [...googleFonts].sort((a, b) => a.popularity - b.popularity);

  let matched = 0;
  let unmatched = 0;

  const googleEntries = sorted.map((font) => {
    const slug = toPreviewSlug(font.family);
    const previewFile = previewMap.get(slug) ?? null;
    if (previewFile) matched++;
    else unmatched++;
    const { weights, hasItalic } = extractWeights(font.fonts);
    const category = normalizeCategory(font.category);
    return { family: font.family, category, weights, hasItalic, previewFile };
  });

  console.log(`  Matched ${matched} fonts to preview images, ${unmatched} without previews`);

  const lines: string[] = [];
  lines.push('// Auto-generated by scripts/generate-font-catalog.ts — do not edit manually');
  lines.push('');
  lines.push('export type FontCategory = \'sans-serif\' | \'serif\' | \'display\' | \'handwriting\' | \'monospace\';');
  lines.push('');
  lines.push('export interface FontEntry {');
  lines.push('  readonly family: string;');
  lines.push('  readonly category: FontCategory;');
  lines.push('  readonly weights: readonly number[];');
  lines.push('  readonly hasItalic: boolean;');
  lines.push('  readonly source: \'google\' | \'system\';');
  lines.push('  readonly previewFile: string | null;');
  lines.push('}');
  lines.push('');

  // System fonts
  lines.push('const SYSTEM_FONTS: readonly FontEntry[] = [');
  for (const sf of systemFonts) {
    lines.push(`  { family: ${JSON.stringify(sf.family)}, category: ${JSON.stringify(sf.category)}, weights: [${sf.weights.join(', ')}], hasItalic: ${sf.hasItalic}, source: 'system', previewFile: null },`);
  }
  lines.push('];');
  lines.push('');

  // Google fonts
  lines.push('const GOOGLE_FONTS: readonly FontEntry[] = [');
  for (const gf of googleEntries) {
    lines.push(`  { family: ${JSON.stringify(gf.family)}, category: ${JSON.stringify(gf.category)}, weights: [${gf.weights.join(', ')}], hasItalic: ${gf.hasItalic}, source: 'google', previewFile: ${JSON.stringify(gf.previewFile)} },`);
  }
  lines.push('];');
  lines.push('');

  lines.push('export const FONT_CATALOG: readonly FontEntry[] = [...SYSTEM_FONTS, ...GOOGLE_FONTS];');
  lines.push('');
  lines.push('export const fontsByFamily: ReadonlyMap<string, FontEntry> = new Map(');
  lines.push('  FONT_CATALOG.map((entry) => [entry.family, entry]),');
  lines.push(');');
  lines.push('');

  return lines.join('\n');
}

async function main() {
  try {
    const [metadata, previewMap] = await Promise.all([
      fetchMetadata(),
      Promise.resolve(downloadAndExtractPreviews()),
    ]);

    const output = generateTypeScript(metadata, previewMap);
    writeFileSync(OUTPUT_PATH, output, 'utf-8');
    console.log(`\nWrote ${OUTPUT_PATH}`);
    console.log(`  ${output.split('\n').length} lines, ${(output.length / 1024).toFixed(1)} KB`);

    // Clean up
    rmSync(TMP_DIR, { recursive: true });
    console.log('Done!');
  } catch (err) {
    console.error('Error:', err);
    if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
    process.exit(1);
  }
}

main();
