import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';

// The agent-facing documents (SKILL.md, FEATURES.md, llms.txt) are
// published at the site root, linked from Help → Agents and announced, with
// window.lopsy, in a comment at the top of <body> on the editor.

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
    for (const doc of ['SKILL.md', 'FEATURES.md']) {
      const response = await request.get(`/${doc}`);
      expect(response.headers()['content-type'], doc).toContain('text/markdown');
      expect(await response.text(), doc).toBe(readFileSync(doc, 'utf8'));
    }

    const llms = await request.get('/llms.txt');
    const llmsText = await llms.text();
    expect(llmsText.startsWith('# Lopsy')).toBe(true);
    expect(llmsText).toContain('https://lopsy.art/SKILL.md');
    expect(llmsText).not.toContain('SKILL-UI');
    expect(llmsText).toContain('https://lopsy.art/FEATURES.md');
    expect(llmsText).toContain('https://lopsy.art/)');
    expect(llmsText).toContain('window.lopsy');
    expect(llmsText).not.toContain('no API');
    expect(llmsText).toContain('https://github.com/theseamusjames/lopsy.art');
    expect(llmsText).toContain('we accept pull requests written by AI agents');

    await page.goto('/');
    const firstBodyComment = await page.evaluate(() => {
      const node = Array.from(document.body.childNodes).find((n) => n.nodeType !== Node.TEXT_NODE);
      return node?.nodeType === Node.COMMENT_NODE ? node.textContent ?? '' : '';
    });
    expect(firstBodyComment).toContain('this page has window.lopsy');
    expect(firstBodyComment).toContain('/llms.txt');
    expect(firstBodyComment).toContain('/SKILL.md');
    expect(firstBodyComment).toContain('/FEATURES.md');
    expect(firstBodyComment).toContain('https://github.com/theseamusjames/lopsy.art');
    expect(firstBodyComment).toContain('We accept pull');
  });

  test('SKILL.md sends agents to the editor', () => {
    const skill = readFileSync('SKILL.md', 'utf8');
    expect(skill).toContain('Open <https://lopsy.art/>');
    expect(skill).toContain("const LOPSY_URL = process.env.LOPSY_URL ?? 'https://lopsy.art/';");
  });
});
