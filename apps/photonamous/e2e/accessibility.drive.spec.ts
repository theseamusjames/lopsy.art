import { clickFocusesButtons, expect, test } from './test';
import { axeViolations } from './axe';

/**
 * Accessibility of what only a build with Google sign-in shows: the start
 * screen's "Try it now", and the three steps with Continue with Google it
 * opens. The rest of the app is in accessibility.spec.ts.
 */
test('the start screen and the three steps', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Photonamous' })).toBeVisible({ timeout: 15_000 });
  expect(await axeViolations(page), 'start screen').toEqual([]);

  const tryIt = page.getByRole('button', { name: 'Try it now' });
  if (clickFocusesButtons) {
    await tryIt.click();
  } else {
    // Safari does not focus a clicked button, so there is no focus to give back: open it from the keyboard.
    await tryIt.focus();
    await page.keyboard.press('Enter');
  }
  const steps = page.getByRole('dialog', { name: 'How it works' });
  await expect(steps).toBeVisible();
  await expect(steps.getByRole('heading', { level: 3 })).toHaveText([
    'Step 1Connect with Google',
    'Step 2Upload your photos',
    'Step 3Edit and export',
  ]);
  // The way in has focus, so Enter signs in.
  await expect(steps.getByRole('button', { name: 'Continue with Google' })).toBeFocused();
  expect(await axeViolations(page), 'the three steps').toEqual([]);

  await page.keyboard.press('Escape');
  await expect(steps).toBeHidden();
  await expect(page.getByRole('button', { name: 'Try it now' })).toBeFocused();
});
