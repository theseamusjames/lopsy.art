import { chromium, type Browser, type Page } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '../public/font-previews');
const MANIFEST_PATH = path.resolve(OUTPUT_DIR, 'manifest.json');
const CONCURRENCY = 5;
const FONT_SIZE = 24;
const TEXT_COLOR = '#e0e0e0';

interface FontMeta {
  family: string;
  category: string;
}

const CATEGORY_MAP: Record<string, string> = {
  SANS_SERIF: 'sans-serif',
  SERIF: 'serif',
  DISPLAY: 'sans-serif',
  HANDWRITING: 'cursive',
  MONOSPACE: 'monospace',
};

async function fetchFontList(): Promise<FontMeta[]> {
  const res = await fetch('https://fonts.google.com/metadata/fonts');
  const text = await res.text();
  // Response has )]}' XSSI prefix
  const json = JSON.parse(text.replace(/^\)\]\}'\n?/, ''));

  return json.familyMetadataList.map(
    (f: { family: string; category: string }) => ({
      family: f.family,
      category: CATEGORY_MAP[f.category] ?? 'sans-serif',
    }),
  );
}

function sanitizeFilename(family: string): string {
  return family.replace(/\s+/g, '_');
}

function googleFontCssUrl(family: string): string {
  const name = family.replace(/\s+/g, '+');
  return `https://fonts.googleapis.com/css2?family=${name}&display=swap`;
}

async function renderFont(
  page: Page,
  font: FontMeta,
): Promise<Buffer | null> {
  const cssUrl = googleFontCssUrl(font.family);

  await page.setContent(
    `<!DOCTYPE html>
<html><head><link rel="stylesheet" href="${cssUrl}"></head>
<body><canvas id="c"></canvas></body></html>`,
  );

  try {
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
    await page.evaluate(async (family: string) => {
      await document.fonts.ready;
      await document.fonts.load(`${24}px "${family}"`);
    }, font.family);
  } catch {
    // Font may still have loaded despite timeout
  }

  const dataUrl = await page.evaluate(
    ({ family, size, color }: { family: string; size: number; color: string }) => {
      const canvas = document.getElementById('c') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      ctx.font = `${size}px "${family}"`;
      const metrics = ctx.measureText(family);

      const pad = 2;
      const w =
        Math.ceil(
          metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
        ) +
        pad * 2;
      const h =
        Math.ceil(
          metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
        ) +
        pad * 2;

      canvas.width = Math.max(w, 1);
      canvas.height = Math.max(h, 1);

      // Re-set font after canvas resize clears state
      ctx.font = `${size}px "${family}"`;
      ctx.fillStyle = color;
      ctx.fillText(
        family,
        metrics.actualBoundingBoxLeft + pad,
        metrics.actualBoundingBoxAscent + pad,
      );

      return canvas.toDataURL('image/png');
    },
    { family: font.family, size: FONT_SIZE, color: TEXT_COLOR },
  );

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return Buffer.from(base64, 'base64');
}

async function processWorker(
  browser: Browser,
  fonts: FontMeta[],
  workerIdx: number,
  results: FontMeta[],
  progress: { done: number; total: number },
): Promise<void> {
  const page = await browser.newPage();

  for (let i = workerIdx; i < fonts.length; i += CONCURRENCY) {
    const font = fonts[i];
    const filename = sanitizeFilename(font.family) + '.png';
    const filepath = path.join(OUTPUT_DIR, filename);

    // Skip already-generated previews (allows resuming)
    if (fs.existsSync(filepath)) {
      results.push(font);
      progress.done++;
      continue;
    }

    try {
      const buf = await renderFont(page, font);
      if (buf) {
        fs.writeFileSync(filepath, buf);
        results.push(font);
      }
    } catch (err) {
      console.error(`Failed: ${font.family} —`, (err as Error).message);
    }

    progress.done++;
    if (progress.done % 50 === 0 || progress.done === progress.total) {
      console.log(
        `Progress: ${progress.done}/${progress.total} (${Math.round((progress.done / progress.total) * 100)}%)`,
      );
    }
  }

  await page.close();
}

async function main(): Promise<void> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Fetching Google Fonts list...');
  const fonts = await fetchFontList();
  console.log(`Found ${fonts.length} fonts`);

  const browser = await chromium.launch();
  const results: FontMeta[] = [];
  const progress = { done: 0, total: fonts.length };

  const workers = Array.from({ length: CONCURRENCY }, (_, i) =>
    processWorker(browser, fonts, i, results, progress),
  );

  await Promise.all(workers);
  await browser.close();

  // Sort manifest alphabetically
  results.sort((a, b) => a.family.localeCompare(b.family));
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(results));

  console.log(`Done! Generated ${results.length} font previews.`);
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(`Previews: ${OUTPUT_DIR}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
