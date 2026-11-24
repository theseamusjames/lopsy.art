import type { Locator, Page } from '@playwright/test';

/** The Mask panel, open beside the toolbar. */
export function maskPanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Mask', exact: true });
}

/** New mask, at the panel's foot, then the kind from its menu. The Mask panel must be open. */
export async function newMask(page: Page, kind: 'Linear' | 'Radial'): Promise<void> {
  await maskPanel(page).getByRole('button', { name: 'New mask', exact: true }).click();
  await page.getByRole('menu', { name: 'New mask' }).getByRole('menuitem', { name: new RegExp(`^${kind}`) }).click();
}

/** The heading button of the mask called `name`: it opens and folds the mask's section. */
export function maskHeading(page: Page, name: string): Locator {
  return maskPanel(page).getByRole('button', { name, exact: true });
}

/** Types `value` into the box of the open mask's `label` adjustment. */
export async function setMaskValue(page: Page, mask: string, label: string, value: string): Promise<void> {
  const readout = page.getByRole('group', { name: `${mask} adjustments` }).getByLabel(`${label} value`, { exact: true });
  await readout.fill(value);
  await readout.press('Enter');
}
