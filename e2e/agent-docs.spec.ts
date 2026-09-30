import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';

// The agent-facing documents (SKILL.md, FEATURES.md, llms.txt) are published at
// the site root, linked from Help → Agents and announced in a comment at the
// top of <body>.

test.describe('agent docs', () => {
  test('Help → Agents opens llms.txt in a new tab', async ({ page, context }) => {
    await page.goto('/');
    await page.getByRole('dialog', { name: 'New Document' }).getByRole('button', { name: 'Create' }).click();

    const menuBar = page.locator('nav[aria-label="Application menu"]');
    await menuBar.getByRole('button', { name: 'Help', exact: true }).click();
    const popupPromise = context.waitForEvent('page');
    await page.locator('[role="menu"][aria-label="Help"]').getByRole('menuitem', { name: 'Agents' }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();

    expect(new URL(popup.url()).pathname).toBe('/llms.txt');
    const body = await popup.locator('body').innerText();
    expect(body.trim()).toBe(readFileSync('public/llms.txt', 'utf8').trim());
    // The editor stays open in the original tab.
    await expect(menuBar).toBeVisible();
  });

  test('serves SKILL.md, FEATURES.md and llms.txt, and announces them in <body>', async ({ page, request }) => {
    const skill = await request.get('/SKILL.md');
    expect(skill.headers()['content-type']).toContain('text/markdown');
    expect(await skill.text()).toBe(readFileSync('SKILL.md', 'utf8'));

    const features = await request.get('/FEATURES.md');
    expect(features.headers()['content-type']).toContain('text/markdown');
    expect(await features.text()).toBe(readFileSync('FEATURES.md', 'utf8'));

    const llms = await request.get('/llms.txt');
    const llmsText = await llms.text();
    expect(llmsText.startsWith('# Lopsy')).toBe(true);
    expect(llmsText).toContain('https://lopsy.art/SKILL.md');
    expect(llmsText).toContain('https://lopsy.art/FEATURES.md');
    expect(llmsText).toContain('https://github.com/theseamusjames/lopsy.art');
    expect(llmsText).toContain('we accept pull requests written by AI agents');

    await page.goto('/');
    const firstBodyComment = await page.evaluate(() => {
      const node = Array.from(document.body.childNodes).find((n) => n.nodeType !== Node.TEXT_NODE);
      return node?.nodeType === Node.COMMENT_NODE ? node.textContent ?? '' : '';
    });
    expect(firstBodyComment).toContain('/llms.txt');
    expect(firstBodyComment).toContain('/SKILL.md');
    expect(firstBodyComment).toContain('/FEATURES.md');
    expect(firstBodyComment).toContain('https://github.com/theseamusjames/lopsy.art');
    expect(firstBodyComment).toContain('We accept pull');
  });
});
