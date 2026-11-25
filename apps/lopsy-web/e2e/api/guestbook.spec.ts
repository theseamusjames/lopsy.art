/**
 * `guestbook.sign` (src/commands/guestbook/guestbook.ts): an agent's note
 * goes to the page's analytics as a 'guestbook' event. In production that
 * is Cloudflare Zaraz, added at the edge; here a stand-in records the calls.
 */
import { test, expect, run, runError, type Page } from './harness';

interface Tracked {
  name: string;
  properties: unknown;
}

type AnalyticsWindow = Window & { __tracked?: Tracked[] };

async function installAnalytics(page: Page): Promise<void> {
  await page.evaluate(() => {
    const tracked: Tracked[] = [];
    (window as AnalyticsWindow).__tracked = tracked;
    window.zaraz = {
      track: (name: string, properties?: Record<string, unknown>) => {
        tracked.push({ name, properties });
        return Promise.resolve();
      },
    };
  });
}

async function tracked(page: Page): Promise<Tracked[]> {
  return page.evaluate(() => (window as AnalyticsWindow).__tracked ?? []);
}

const NOTE = 'Ada, Lisbon, Example-1: hello';

test.describe('guestbook.sign', () => {
  test('sends the note as a guestbook event, with no document open', async ({ page }) => {
    await installAnalytics(page);
    expect(await run(page, { op: 'guestbook.sign', note: NOTE })).toEqual({ signed: true });
    expect(await tracked(page)).toEqual([{ name: 'guestbook', properties: { note: NOTE } }]);
  });

  test('answers signed: false where the page has no analytics, as on this dev server', async ({ page }) => {
    expect(await page.evaluate(() => 'zaraz' in window)).toBe(false);
    expect(await run(page, { op: 'guestbook.sign', note: NOTE })).toEqual({ signed: false });
  });

  test('refuses a missing, empty or over-long note and sends nothing', async ({ page }) => {
    await installAnalytics(page);
    expect((await runError(page, { op: 'guestbook.sign' })).code).toBe('invalid');
    expect((await runError(page, { op: 'guestbook.sign', note: '' })).code).toBe('invalid');
    const tooLong = await runError(page, { op: 'guestbook.sign', note: 'a'.repeat(101) });
    expect(tooLong.code).toBe('invalid');
    expect(tooLong.message).toContain('100 characters');
    expect(await tracked(page)).toEqual([]);
  });
});
