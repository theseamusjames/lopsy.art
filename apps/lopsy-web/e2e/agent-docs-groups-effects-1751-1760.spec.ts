/**
 * #1751 — SKILL.md said group effects apply to a group, but a group's drawer
 *         holds only Blend and adjustments: there is no effects list, so an
 *         agent's h.effect() on a group timed out.
 * #1760 — FEATURES.md said there was no Copy / Paste Layer Style, while the
 *         effects drawer has Copy effects / Paste effects.
 *
 * The UI half pins the behaviour the docs now describe; the text half fails
 * if either stale sentence comes back.
 */
import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { waitForStore, createDocument, drawRect, openEffectsPanel } from './helpers';

test.describe('Agent docs on group effects and copying effects (#1751, #1760)', () => {
  test('a group drawer shows adjustments only, and SKILL-UI.md says so', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the layers panel toolbar is a desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 800, 600, false);
    await drawRect(page, 100, 100, 200, 150, { r: 200, g: 40, b: 40 });

    await page.locator('[aria-label="New Group"]').click();
    const groupButton = page.locator('button[aria-label^="Group effects for"]').first();
    await groupButton.click();

    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('[aria-label="Add Adjustment"]')).toBeVisible();
    await expect(drawer.locator('[aria-label="Enable Drop Shadow"]')).toHaveCount(0);

    const skill = readFileSync('SKILL-UI.md', 'utf8');
    expect(skill).not.toContain('Group effects and adjustment layers apply to everything inside the group');
    const groups = skill.slice(skill.indexOf('**Groups.**'), skill.indexOf('**Guides and grid.**'));
    expect(groups).toContain('no layer effects');
    expect(groups).toContain('Paste effects');
  });

  test('a layer drawer has Copy effects / Paste effects, and FEATURES.md does not deny them', async ({ page, isMobile }) => {
    test.skip(isMobile, 'the effects drawer is a desktop layout');
    await page.goto('/');
    await waitForStore(page);
    await createDocument(page, 400, 300, false);
    await drawRect(page, 50, 50, 100, 80, { r: 0, g: 0, b: 255 });
    await openEffectsPanel(page);

    const drawer = page.getByTestId('effects-drawer');
    await expect(drawer.getByRole('button', { name: 'Copy effects' })).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Paste effects' })).toBeVisible();

    const features = readFileSync('FEATURES.md', 'utf8');
    expect(features).not.toMatch(/no Copy \/ Paste Layer Style/);
    const rasterize = features.slice(features.indexOf('Rasterize Layer Style'));
    expect(rasterize).toContain('[Copying and pasting effects](#copying-and-pasting-effects)');
  });
});
