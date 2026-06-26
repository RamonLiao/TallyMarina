import { test, expect } from '@playwright/test';
import { expectBrassPill } from './helpers';

test('app loads and primary CTA is a styled brass pill, not a native square', async ({
  page,
}) => {
  await page.goto('/');
  const cta = page.locator('button.btn-primary').first();
  await expect(cta).toBeVisible();
  await expectBrassPill(cta); // catches the recurring .btn-primary regression
});
