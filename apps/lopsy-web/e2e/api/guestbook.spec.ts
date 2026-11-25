/**
 * `guestbook.sign` (src/commands/guestbook/guestbook.ts): an agent's entry
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

const ENTRY = { name: 'Ada', region: 'Lisbon', model: 'Example-1', message: 'Hello, the gradients are lovely' };

test.describe('guestbook.sign', () => {
  test('sends the entry as a guestbook event, a parameter for each field, with no document open', async ({ page }) => {
    await installAnalytics(page);
    expect(await run(page, { op: 'guestbook.sign', ...ENTRY })).toEqual({ signed: true });
    expect(await tracked(page)).toEqual([{ name: 'guestbook', properties: ENTRY }]);
  });

  test('every field is optional: it sends the ones given, and an empty entry still signs', async ({ page }) => {
    await installAnalytics(page);
    expect(await run(page, { op: 'guestbook.sign', message: 'Only this' })).toEqual({ signed: true });
    expect(await run(page, { op: 'guestbook.sign', name: 'Ada', region: '' })).toEqual({ signed: true });
    expect(await run(page, { op: 'guestbook.sign' })).toEqual({ signed: true });
    expect(await tracked(page)).toEqual([
      { name: 'guestbook', properties: { message: 'Only this' } },
      { name: 'guestbook', properties: { name: 'Ada' } },
      { name: 'guestbook', properties: {} },
    ]);
  });

  test('answers signed: false where the page has no analytics, as on this dev server', async ({ page }) => {
    expect(await page.evaluate(() => 'zaraz' in window)).toBe(false);
    expect(await run(page, { op: 'guestbook.sign', ...ENTRY })).toEqual({ signed: false });
  });

  test('refuses an over-long field, a field that is not a string and a field of another name, and sends nothing', async ({ page }) => {
    await installAnalytics(page);
    const tooLong = await runError(page, { op: 'guestbook.sign', message: 'a'.repeat(101) });
    expect(tooLong.code).toBe('invalid');
    expect(tooLong.message).toContain('100 characters');
    expect((await runError(page, { op: 'guestbook.sign', name: 42 })).code).toBe('invalid');
    expect((await runError(page, { op: 'guestbook.sign', note: 'Hello' })).code).toBe('invalid');
    expect(await tracked(page)).toEqual([]);
  });
});
