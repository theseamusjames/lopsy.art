import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

/** axe-core's rules for WCAG 2.2 AA, run on the page as it stands. */

const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

export interface AxeViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly nodes: { readonly target: string; readonly html: string; readonly summary: string }[];
}

export async function axeViolations(page: Page): Promise<AxeViolation[]> {
  await page.waitForTimeout(300);
  const hasAxe = await page.evaluate(() => 'axe' in window);
  if (!hasAxe) await page.addScriptTag({ path: AXE });
  return page.evaluate(async (tags) => {
    const axe = Reflect.get(window, 'axe') as {
      run: (context: Document, options: object) => Promise<{
        violations: { id: string; impact: string | null; help: string; nodes: { target: string[]; html: string; failureSummary?: string }[] }[];
      }>;
    };
    const result = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 240), summary: (n.failureSummary ?? '').slice(0, 400) })),
    }));
  }, TAGS);
}
